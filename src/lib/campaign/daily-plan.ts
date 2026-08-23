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
  current_bundle: CampaignDailyBundle | null
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

export const CampaignDailyCommandSchema = z.object({
  campaign_id: uuidLike,
  days: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        slots: z.object({ post: slotStatusSchema, story: slotStatusSchema, reel: slotStatusSchema }),
      })
    )
    .length(7),
  current_bundle: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    post: z
      .object({ hook: z.string().min(1), body: z.string().min(1), cta: z.string().min(1) })
      .nullable(),
    story: z
      .object({
        frames: z.array(z.object({ order: z.number().int(), copy: z.string().min(1) })).min(1),
      })
      .nullable(),
    reel: z
      .object({
        brief: z.string().min(1),
        script: z.string().min(1),
        caption: z.string().min(1),
        source_asset_ids: z.array(uuidLike).default([]),
        media_status: z.enum(['NO_MEDIA', 'DRAFT_MEDIA', 'READY']),
      })
      .nullable(),
  }),
  raw_summary: z.string().optional().nullable(),
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
