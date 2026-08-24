import { describe, expect, it } from 'vitest'
import {
  computeGrounding,
  computeReadiness,
  buildEmptyDays,
  buildPublishingPlan,
  buildAdCandidate,
  CampaignDailyCommandSchema,
  type CampaignDailyBundle,
} from '../daily-plan'

const CAMPAIGN = { id: 'c1', client_id: 'cts', title: 'X' } as never
const BRIEF = { id: 'b1' }

describe('computeGrounding', () => {
  it('OK when both campaign and master brief resolve', () => {
    expect(computeGrounding(CAMPAIGN, BRIEF).status).toBe('OK')
  })
  it('NEEDS_BRIEF when campaign exists but no active master brief', () => {
    expect(computeGrounding(CAMPAIGN, null).status).toBe('NEEDS_BRIEF')
  })
  it('NEEDS_CAMPAIGN when campaign does not resolve, regardless of brief', () => {
    expect(computeGrounding(null, BRIEF).status).toBe('NEEDS_CAMPAIGN')
    expect(computeGrounding(null, null).status).toBe('NEEDS_CAMPAIGN')
  })
})

describe('buildEmptyDays', () => {
  it('returns exactly 7 consecutive days, all NOT_PLANNED', () => {
    const days = buildEmptyDays('2026-08-24')
    expect(days).toHaveLength(7)
    expect(days[0].date).toBe('2026-08-24')
    expect(days[6].date).toBe('2026-08-30')
    for (const d of days) {
      expect(d.slots).toEqual({ post: 'NOT_PLANNED', story: 'NOT_PLANNED', reel: 'NOT_PLANNED' })
    }
  })
})

describe('computeReadiness', () => {
  const grounding = { status: 'OK' as const, has_master_brief: true, has_campaign: true }

  it('is false across the board with no bundle', () => {
    const r = computeReadiness({ grounding, bundle: null, resolvedAssetIds: new Set() })
    expect(r.format_completeness).toEqual({ post: false, story: false, reel: false })
    expect(r.client_asset_provenance).toBe(false)
    expect(r.provider_authorization).toBe(false)
    expect(r.publishing_authorization).toBe(false)
    expect(r.performance_outcome).toBe('UNKNOWN')
  })

  it('flags asset provenance false when a referenced asset id was not resolved', () => {
    const bundle: CampaignDailyBundle = {
      date: '2026-08-24',
      post: null,
      story: null,
      reel: { brief: 'b', script: 's', caption: 'c', source_asset_ids: ['a1'], media_status: 'NO_MEDIA' },
    }
    const r = computeReadiness({ grounding, bundle, resolvedAssetIds: new Set() })
    expect(r.client_asset_provenance).toBe(false)
  })

  it('flags asset provenance true only when every referenced id resolved', () => {
    const bundle: CampaignDailyBundle = {
      date: '2026-08-24',
      post: null,
      story: null,
      reel: { brief: 'b', script: 's', caption: 'c', source_asset_ids: ['a1', 'a2'], media_status: 'NO_MEDIA' },
    }
    expect(computeReadiness({ grounding, bundle, resolvedAssetIds: new Set(['a1']) }).client_asset_provenance).toBe(false)
    expect(computeReadiness({ grounding, bundle, resolvedAssetIds: new Set(['a1', 'a2']) }).client_asset_provenance).toBe(true)
  })

  it('never marks a reel media-ready as a side effect of readiness — media_status is display-only, untouched', () => {
    const bundle: CampaignDailyBundle = {
      date: '2026-08-24',
      post: null,
      story: null,
      reel: { brief: 'b', script: 's', caption: 'c', source_asset_ids: [], media_status: 'NO_MEDIA' },
    }
    const r = computeReadiness({ grounding, bundle, resolvedAssetIds: new Set() })
    expect(r.format_completeness.reel).toBe(true) // reel draft exists...
    expect(bundle.reel?.media_status).toBe('NO_MEDIA') // ...but media is honestly not ready
  })
})

describe('buildPublishingPlan / buildAdCandidate — always plan-only', () => {
  it('publishing plan is always NOT_AUTHORIZED', () => {
    expect(buildPublishingPlan(CAMPAIGN).status).toBe('NOT_AUTHORIZED')
    expect(buildPublishingPlan(null).status).toBe('NOT_AUTHORIZED')
  })

  it('ad candidate is null without a reel draft, and NOT_AUTHORIZED with one', () => {
    expect(buildAdCandidate(null)).toBeNull()
    const bundle: CampaignDailyBundle = {
      date: '2026-08-24',
      post: null,
      story: null,
      reel: { brief: 'b', script: 's', caption: 'c', source_asset_ids: [], media_status: 'NO_MEDIA' },
    }
    const ad = buildAdCandidate(bundle)
    expect(ad?.status).toBe('NOT_AUTHORIZED')
    expect(ad?.goal).toBe('UNKNOWN')
  })
})

describe('CampaignDailyCommandSchema', () => {
  const CAMPAIGN_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
  const days = Array.from({ length: 7 }, (_, i) => ({
    date: `2026-08-2${i}`,
    slots: { post: 'NOT_PLANNED' as const, story: 'NOT_PLANNED' as const, reel: 'NOT_PLANNED' as const },
  }))

  it('accepts a well-formed command using this repo\'s loose (non-RFC4122) id shape', () => {
    const parsed = CampaignDailyCommandSchema.safeParse({
      campaign_id: 'c0000000-0000-0000-0000-000000000000', // CTS's real id shape
      days,
      bundles: [{ date: '2026-08-24', post: null, story: null, reel: null }],
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects a plan with fewer or more than 7 days', () => {
    const parsed = CampaignDailyCommandSchema.safeParse({
      campaign_id: CAMPAIGN_ID,
      days: days.slice(0, 6),
      bundles: [{ date: '2026-08-24', post: null, story: null, reel: null }],
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a plan with zero bundles', () => {
    const parsed = CampaignDailyCommandSchema.safeParse({
      campaign_id: CAMPAIGN_ID,
      days,
      bundles: [],
    })
    expect(parsed.success).toBe(false)
  })

  it('accepts a plan with 1-7 bundles (not every day needs to be filled at once)', () => {
    const parsed = CampaignDailyCommandSchema.safeParse({
      campaign_id: CAMPAIGN_ID,
      days,
      bundles: [
        { date: '2026-08-24', post: null, story: null, reel: null },
        { date: '2026-08-25', post: null, story: null, reel: null },
      ],
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects a story bundle with zero frames', () => {
    const parsed = CampaignDailyCommandSchema.safeParse({
      campaign_id: CAMPAIGN_ID,
      days,
      bundles: [{ date: '2026-08-24', post: null, story: { frames: [] }, reel: null }],
    })
    expect(parsed.success).toBe(false)
  })

  // Regression (#1159 remediation, Build Control finding 3): a command must
  // never be able to assert a Reel is READY — WP1 has no way to verify a
  // real output exists, so accepting the claim would let the UI show
  // "可用成片" for a reel that is still just a script. Reject at the schema
  // boundary rather than trusting-then-filtering downstream.
  it('rejects a Reel command that declares media_status READY — WP1 cannot verify a real output', () => {
    const parsed = CampaignDailyCommandSchema.safeParse({
      campaign_id: CAMPAIGN_ID,
      days,
      bundles: [{
        date: '2026-08-24',
        post: null,
        story: null,
        reel: { brief: 'b', script: 's', caption: 'c', source_asset_ids: [], media_status: 'READY' },
      }],
    })
    expect(parsed.success).toBe(false)
  })

  it('still accepts the honest NO_MEDIA / DRAFT_MEDIA statuses', () => {
    for (const media_status of ['NO_MEDIA', 'DRAFT_MEDIA']) {
      const parsed = CampaignDailyCommandSchema.safeParse({
        campaign_id: CAMPAIGN_ID,
        days,
        bundles: [{
          date: '2026-08-24',
          post: null,
          story: null,
          reel: { brief: 'b', script: 's', caption: 'c', source_asset_ids: [], media_status },
        }],
      })
      expect(parsed.success).toBe(true)
    }
  })
})
