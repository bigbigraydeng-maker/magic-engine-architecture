/**
 * Campaign Daily Plan — WP1 (#1159) projection shape and pure helpers.
 *
 * Storage: reuses the existing `social_plans` table (jsonb `plan_data`,
 * no migration). A row is tagged `plan_data.plan_kind === 'campaign_daily_v1'`
 * so it never collides with the legacy wave-batch `SocialPlanOutput` shape
 * already stored there by /api/clients/[id]/social-plan.
 */

import { z } from 'zod'
import type { CampaignBrief } from '@/types/magic-engine'

export const CAMPAIGN_DAILY_PLAN_KIND = 'campaign_daily_v1' as const

export type SlotStatus = 'PLANNED' | 'NOT_PLANNED'
export type GroundingStatus = 'OK' | 'NEEDS_BRIEF' | 'NEEDS_CAMPAIGN'
export type ReelMediaStatus = 'NO_MEDIA' | 'DRAFT_MEDIA' | 'READY'

export interface CampaignDailyDaySlots {
  post: SlotStatus
  story: SlotStatus
  reel: SlotStatus
}

export interface CampaignDailyDay {
  date: string // YYYY-MM-DD
  slots: CampaignDailyDaySlots
}

export interface CampaignDailyPostDraft {
  hook: string
  body: string
  cta: string
  /** Exact CTS-client-scoped asset ID for the Post image. Never trusted from
   *  caller-supplied URL/ownership — the server re-resolves both from the
   *  authoritative `client_assets` row. */
  image_asset_id: string
  /** HTTPS destination for the Post's Enquire Now link. Must exactly match
   *  the selected Campaign's persisted source URL — no arbitrary caller
   *  destination is accepted (route.ts enforces). */
  cta_url: string
}

export interface CampaignDailyStoryFrame {
  order: number
  copy: string
}

export interface CampaignDailyStoryDraft {
  frames: CampaignDailyStoryFrame[]
}

export interface CampaignDailyReelDraft {
  brief: string
  script: string
  caption: string
  source_asset_ids: string[]
  media_status: ReelMediaStatus
}

export interface CampaignDailyBundle {
  date: string
  post: CampaignDailyPostDraft | null
  story: CampaignDailyStoryDraft | null
  reel: CampaignDailyReelDraft | null
}

export interface CampaignDailyPlanData {
  plan_kind: typeof CAMPAIGN_DAILY_PLAN_KIND
  campaign_id: string
  master_brief_ref: { id: string; version: number | null } | null
  days: CampaignDailyDay[]
  /**
   * One entry per day that has real content — may be 1 to 7 entries.
   * A day present in `days` with PLANNED slots but no matching entry here
   * is a data-shape bug (route.ts fails closed to an honest empty bundle
   * for that date), not silently borrowed from another day.
   */
  bundles: CampaignDailyBundle[]
  command_meta: {
    source: 'conversation_command'
    received_at: string
    raw_summary: string | null
  }
}

// ─── Inbound command schema (Section A — conversation-command persistence seam) ──
// The agent (Claude/Codex) interprets Ray's spoken instruction and calls this
// contract; this module never talks to an LLM/provider itself.

const slotStatusSchema = z.enum(['PLANNED', 'NOT_PLANNED'])

// Loose UUID *shape* check, not strict RFC4122 version validation — this
// repo's own seeded client ids (e.g. CTS `c0000000-0000-0000-0000-…`) do not
// carry a valid version/variant nibble, so zod's built-in `.uuid()` rejects
// them.
const uuidLike = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'invalid id')

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

// A bundle inside a POST snapshot is COMPLETE: Post + 4-frame Story + Reel
// are all required. Partial days (e.g. Post-only) are not accepted through
// this seam — they would either force a per-bundle grounding/merge layer
// (deferred) or leave the stored snapshot ambiguous. GET keeps rendering
// null Post/Story/Reel entries from legacy rows honestly; that read
// tolerance does not extend to the write contract.
// HTTPS-only URL check for the Post CTA — an http:// destination on a
// public-facing customer button would strip TLS mid-click.
const httpsUrl = z
  .string()
  .refine((v) => {
    try {
      const u = new URL(v)
      return u.protocol === 'https:'
    } catch {
      return false
    }
  }, { message: 'must be a well-formed HTTPS URL' })

const bundleSchema = z.object({
  date: dateStringSchema,
  post: z.object({
    hook: z.string().min(1),
    body: z.string().min(1),
    cta: z.string().min(1),
    // Server re-resolves ownership/preview from client_assets — caller does
    // NOT supply URL, MIME, or ownership here. Just the ID.
    image_asset_id: uuidLike,
    cta_url: httpsUrl,
  }),
  story: z.object({
    frames: z
      .array(z.object({ order: z.number().int(), copy: z.string().min(1) }))
      .length(4),
  }),
  reel: z.object({
    brief: z.string().min(1),
    script: z.string().min(1),
    caption: z.string().min(1),
    source_asset_ids: z.array(uuidLike).default([]),
    // WP1 has no real-output verification path (no render job linkage
    // wired up), so the command may never assert READY — the server has
    // no way to check it and would just be relaying an unverified claim
    // to a reviewer who reads "READY" as "there is a real file". A
    // future WP that wires up verified output can derive READY
    // server-side; it must never come from caller input.
    media_status: z.enum(['NO_MEDIA', 'DRAFT_MEDIA']),
  }),
})

// This seam is now a COMPLETE seven-day snapshot only:
//
// - exactly 7 unique day records;
// - exactly 7 unique bundles;
// - bundle date set must exactly equal day date set;
// - every day must have Post + 4-frame Story + Reel.
//
// Partial writes are rejected; the stored snapshot is REPLACED on success
// (see route.ts POST — no merge with previously stored bundles). This
// removes the stale-window and false-grounding risks that a per-bundle
// merge algorithm would otherwise reintroduce.
export const CampaignDailyCommandSchema = z
  .object({
    campaign_id: uuidLike,
    days: z
      .array(
        z.object({
          date: dateStringSchema,
          slots: z.object({ post: slotStatusSchema, story: slotStatusSchema, reel: slotStatusSchema }),
        })
      )
      .length(7)
      .refine(
        days => new Set(days.map(d => d.date)).size === days.length,
        { message: 'duplicate date in days — one entry per day only' }
      ),
    bundles: z
      .array(bundleSchema)
      .length(7)
      .refine(
        bundles => new Set(bundles.map(b => b.date)).size === bundles.length,
        { message: 'duplicate date in bundles — one entry per day only' }
      ),
    raw_summary: z.string().optional().nullable(),
  })
  // The bundle date set must exactly equal the days date set — a bundle for a
  // date not in the schedule (or a scheduled day with no bundle) would
  // silently disappear from the 7-day grid render.
  .superRefine((val, ctx) => {
    const dayDates = new Set(val.days.map(d => d.date))
    const bundleDates = new Set(val.bundles.map(b => b.date))
    val.bundles.forEach((b, i) => {
      if (!dayDates.has(b.date)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['bundles', i, 'date'],
          message: `bundle date ${b.date} is not one of the seven scheduled days`,
        })
      }
    })
    val.days.forEach((d, i) => {
      if (!bundleDates.has(d.date)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['days', i, 'date'],
          message: `scheduled day ${d.date} has no matching bundle`,
        })
      }
    })

    // Every day's Post image must be a DISTINCT asset — "one image for all
    // seven days" is exactly the review-blocker this contract closes.
    const imageIds = val.bundles.map((b) => b.post.image_asset_id)
    if (new Set(imageIds).size !== imageIds.length) {
      val.bundles.forEach((b, i) => {
        const firstIdx = imageIds.indexOf(b.post.image_asset_id)
        if (firstIdx !== i) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['bundles', i, 'post', 'image_asset_id'],
            message: `duplicate Post image_asset_id — day ${b.date} reuses the same asset as an earlier day`,
          })
        }
      })
    }
  })

export type CampaignDailyCommand = z.infer<typeof CampaignDailyCommandSchema>

// ─── Grounding ──────────────────────────────────────────────────────────────

export interface CampaignDailyGrounding {
  status: GroundingStatus
  has_master_brief: boolean
  has_campaign: boolean
}

export function computeGrounding(
  campaign: CampaignBrief | null,
  masterBrief: { id: string } | null
): CampaignDailyGrounding {
  if (!campaign) {
    return { status: 'NEEDS_CAMPAIGN', has_master_brief: !!masterBrief, has_campaign: false }
  }
  if (!masterBrief) {
    return { status: 'NEEDS_BRIEF', has_master_brief: false, has_campaign: true }
  }
  return { status: 'OK', has_master_brief: true, has_campaign: true }
}

// ─── Readiness gates — factual, never a fabricated percentage ───────────────

export interface CampaignDailyReadiness {
  master_brief_grounding: boolean
  campaign_grounding: boolean
  // Master Brief / Campaign grounding above means only "a record is
  // connected" — WP1 does no website crawling, evidence storage or claim
  // extraction, so whether the bundle's claims are factually supported is
  // always UNKNOWN, never inferred from record existence.
  evidence_grounding: 'UNKNOWN'
  client_asset_provenance: boolean
  format_completeness: { post: boolean; story: boolean; reel: boolean }
  human_approval: boolean
  provider_authorization: false
  publishing_authorization: false
  performance_outcome: 'UNKNOWN'
}

export function computeReadiness(params: {
  grounding: CampaignDailyGrounding
  bundle: CampaignDailyBundle | null
  resolvedAssetIds: Set<string>
}): CampaignDailyReadiness {
  const { grounding, bundle, resolvedAssetIds } = params
  const referencedIds = bundle?.reel?.source_asset_ids ?? []
  const assetProvenanceOk =
    referencedIds.length > 0 && referencedIds.every(id => resolvedAssetIds.has(id))

  return {
    master_brief_grounding: grounding.has_master_brief,
    campaign_grounding: grounding.has_campaign,
    evidence_grounding: 'UNKNOWN',
    client_asset_provenance: assetProvenanceOk,
    format_completeness: {
      post: !!bundle?.post,
      story: !!(bundle?.story && bundle.story.frames.length > 0),
      reel: !!bundle?.reel,
    },
    // WP1 ships no approval workflow yet — always honestly false, never inferred.
    human_approval: false,
    provider_authorization: false,
    publishing_authorization: false,
    performance_outcome: 'UNKNOWN',
  }
}

// ─── Publishing / ad preview — always plan-only in WP1 ───────────────────────

export interface CampaignDailyPublishingPlan {
  destination: string | null
  status: 'NOT_AUTHORIZED'
}

export interface CampaignDailyAdCandidate {
  creative_ref: string | null
  goal: 'UNKNOWN'
  audience: 'UNKNOWN'
  destination: 'UNKNOWN'
  budget: 'UNKNOWN'
  status: 'NOT_AUTHORIZED'
}

export function buildPublishingPlan(campaign: CampaignBrief | null): CampaignDailyPublishingPlan {
  return { destination: campaign?.primary_cta ?? null, status: 'NOT_AUTHORIZED' }
}

export function buildAdCandidate(bundle: CampaignDailyBundle | null): CampaignDailyAdCandidate | null {
  if (!bundle?.reel) return null
  return {
    creative_ref: bundle.date,
    goal: 'UNKNOWN',
    audience: 'UNKNOWN',
    destination: 'UNKNOWN',
    budget: 'UNKNOWN',
    status: 'NOT_AUTHORIZED',
  }
}

// ─── Empty 7-day grid (no plan persisted yet) ────────────────────────────────

export function buildEmptyDays(startDateIso: string): CampaignDailyDay[] {
  const start = new Date(`${startDateIso}T00:00:00Z`)
  const days: CampaignDailyDay[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    days.push({
      date: d.toISOString().slice(0, 10),
      slots: { post: 'NOT_PLANNED', story: 'NOT_PLANNED', reel: 'NOT_PLANNED' },
    })
  }
  return days
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}
