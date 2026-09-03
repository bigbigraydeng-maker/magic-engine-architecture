/**
 * Campaign Daily Plan — Facebook publish bridge contract (#1340).
 *
 * This module owns the *contract* only: command/receipt schemas, the
 * deterministic idempotency key, and pure selection helpers. It never talks to
 * a provider and never touches the database — the route does that, so the
 * fail-closed rules here stay unit-testable without a network or a Supabase
 * stub.
 *
 * Relationship to `publish_queue_meta`: that receipt is the *no-publish*
 * handoff ("these reviewed Posts are ready"). This module is the stage after
 * it, and it is the first stage in this pipeline permitted to cause a provider
 * side effect. It therefore refuses to act unless the queue receipt for the
 * exact same plan+review revision already exists.
 *
 * Platform note: the emitted event is deliberately client-agnostic
 * (`daily_plan.post.published`, with `client_id` in the payload) so the
 * downstream T+24/T+72 measurement workflow is shared runtime rather than a
 * per-client branch.
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'

export const DAILY_PLAN_POST_PUBLISHED_EVENT = 'daily_plan.post.published' as const

/** Hours after publish at which the measurement workflow should read back. */
export const PUBLISH_MEASUREMENT_OFFSETS_HOURS = [24, 72] as const

// Same loose UUID *shape* check as daily-plan.ts — this repo's seeded client
// ids (e.g. CTS `c0000000-…`) are not RFC4122-valid, so `z.uuid()` rejects them.
const uuidLike = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'invalid id')

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Meta Page ids are numeric strings; reject anything else before we spend a call. */
const pageIdSchema = z.string().regex(/^\d{5,25}$/, 'page_id must be a numeric Meta Page id')

/**
 * Inbound command.
 *
 * Every authorisation field is a `z.literal(true)`, so a caller that omits one,
 * sends `false`, or sends a truthy non-boolean is rejected at parse time —
 * before any read, any token lookup, and any provider call. That is the
 * fail-closed guarantee; it is enforced by the type, not by a runtime `if`
 * someone can later reorder away.
 *
 * `no_publish` defaults to `true`: a caller who says nothing gets a dry run.
 * Live publishing requires explicitly sending `no_publish: false` *in addition
 * to* both authorisation flags.
 */
export const CampaignDailyPublishCommandSchema = z.object({
  /** Echo of the path client id. Mismatch is refused (see route). */
  client_id: uuidLike,
  campaign_id: uuidLike,
  plan_id: uuidLike,
  plan_revision: z.string().datetime(),
  review_revision: uuidLike,
  page_id: pageIdSchema,
  approved: z.literal(true),
  publish_authorization: z.literal(true),
  no_publish: z.boolean().default(true),
  /** Optional allow-list of dates to publish. Omitted = every reviewed Post. */
  dates: z.array(dateStringSchema).min(1).optional(),
})

export type CampaignDailyPublishCommand = z.infer<typeof CampaignDailyPublishCommandSchema>

export interface CampaignDailyPublishedPost {
  date: string
  idempotency_key: string
  /** Real Graph API post id. Never synthesised. */
  post_id: string
  /** Which Graph field the id came from, so an audit can tell them apart. */
  post_id_source: 'post_id' | 'id'
  page_id: string
  published_at: string
  permalink: string
  /** Raw provider response, stored verbatim for audit. */
  provider_response: Record<string, unknown>
}

export interface CampaignDailyPublishFailure {
  date: string
  idempotency_key: string
  error: string
  failed_at: string
}

export interface CampaignDailyPublishPlannedPost {
  date: string
  idempotency_key: string
  image_asset_id: string
  cta_url: string
}

export type CampaignDailyPublishStatus = 'DRY_RUN' | 'PUBLISHED' | 'PARTIAL' | 'FAILED'

export interface CampaignDailyPublishMeta {
  schema_version: 1
  event_name: typeof DAILY_PLAN_POST_PUBLISHED_EVENT
  status: CampaignDailyPublishStatus
  request_id: string
  client_id: string
  campaign_id: string
  plan_id: string
  plan_revision: string
  review_revision: string
  page_id: string
  publishing_authorization: 'AUTHORIZED'
  approved_by_user_id: string
  created_at: string
  published: CampaignDailyPublishedPost[]
  failed: CampaignDailyPublishFailure[]
  /** Inngest receipt ids, one per successfully emitted published event. */
  event_ids: string[]
}

const publishedPostSchema = z.object({
  date: dateStringSchema,
  idempotency_key: z.string().min(1),
  post_id: z.string().min(1),
  post_id_source: z.enum(['post_id', 'id']),
  page_id: pageIdSchema,
  published_at: z.string().datetime(),
  permalink: z.string().min(1),
  provider_response: z.record(z.string(), z.unknown()),
})

export const CampaignDailyPublishMetaSchema = z.object({
  schema_version: z.literal(1),
  event_name: z.literal(DAILY_PLAN_POST_PUBLISHED_EVENT),
  status: z.enum(['DRY_RUN', 'PUBLISHED', 'PARTIAL', 'FAILED']),
  request_id: uuidLike,
  client_id: uuidLike,
  campaign_id: uuidLike,
  plan_id: uuidLike,
  plan_revision: z.string().datetime(),
  review_revision: uuidLike,
  page_id: pageIdSchema,
  publishing_authorization: z.literal('AUTHORIZED'),
  approved_by_user_id: uuidLike,
  created_at: z.string().datetime(),
  published: z.array(publishedPostSchema),
  failed: z.array(z.object({
    date: dateStringSchema,
    idempotency_key: z.string().min(1),
    error: z.string(),
    failed_at: z.string().datetime(),
  })),
  event_ids: z.array(z.string().min(1)),
})

/**
 * Deterministic per-post idempotency key.
 *
 * Derived from the content identity, not from the attempt: retrying the same
 * command produces the same key, so a duplicate publish is detectable. Editing
 * a Post moves `plan_revision` (a fresh snapshot resets review), which changes
 * the key — republishing genuinely-new copy is allowed and is not mistaken for
 * a retry.
 */
export function publishIdempotencyKey(input: {
  clientId: string
  planId: string
  planRevision: string
  reviewRevision: string
  date: string
}): string {
  const material = [input.clientId, input.planId, input.planRevision, input.reviewRevision, input.date].join('|')
  return `fbpost_${createHash('sha256').update(material).digest('hex').slice(0, 32)}`
}

/**
 * Split candidate dates into "still needs publishing" and "already published".
 *
 * Matching is by idempotency key rather than by date, so a stored receipt from
 * a *different* plan revision never suppresses a genuinely new publish.
 */
export function partitionByIdempotency<T extends { idempotency_key: string }>(
  candidates: T[],
  alreadyPublished: Pick<CampaignDailyPublishedPost, 'idempotency_key'>[],
): { pending: T[]; skipped: T[] } {
  const seen = new Set(alreadyPublished.map(post => post.idempotency_key))
  const pending: T[] = []
  const skipped: T[] = []
  for (const candidate of candidates) {
    if (seen.has(candidate.idempotency_key)) skipped.push(candidate)
    else pending.push(candidate)
  }
  return { pending, skipped }
}

/** ISO timestamps at which the T+24 / T+72 measurement passes should run. */
export function measurementSchedule(publishedAt: string): { hours: number; at: string }[] {
  const base = new Date(publishedAt).getTime()
  return PUBLISH_MEASUREMENT_OFFSETS_HOURS.map(hours => ({
    hours,
    at: new Date(base + hours * 3_600_000).toISOString(),
  }))
}

/** Overall status from the outcome of a live attempt. */
export function resolvePublishStatus(
  publishedCount: number,
  failedCount: number,
): Extract<CampaignDailyPublishStatus, 'PUBLISHED' | 'PARTIAL' | 'FAILED'> {
  if (failedCount === 0) return 'PUBLISHED'
  return publishedCount === 0 ? 'FAILED' : 'PARTIAL'
}
