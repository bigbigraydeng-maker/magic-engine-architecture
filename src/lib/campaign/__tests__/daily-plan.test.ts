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

describe('CampaignDailyCommandSchema — complete seven-day snapshot only', () => {
  const CAMPAIGN_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
  const days = Array.from({ length: 7 }, (_, i) => ({
    date: `2026-08-2${i}`,
    slots: { post: 'PLANNED' as const, story: 'PLANNED' as const, reel: 'PLANNED' as const },
  }))

  const POST_ASSET_IDS = [
    'e0000001-0000-0000-0000-000000000001',
    'e0000002-0000-0000-0000-000000000002',
    'e0000003-0000-0000-0000-000000000003',
    'e0000004-0000-0000-0000-000000000004',
    'e0000005-0000-0000-0000-000000000005',
    'e0000006-0000-0000-0000-000000000006',
    'e0000007-0000-0000-0000-000000000007',
  ]
  const CTA_URL = 'https://example-cts.test/tours/christmas'

  function completeBundle(date: string, overrides: Record<string, unknown> = {}) {
    const idx = Math.max(0, days.findIndex(d => d.date === date))
    return {
      date,
      post: {
        hook: 'h', body: 'b', cta: 'Enquire Now',
        image_asset_id: POST_ASSET_IDS[idx] ?? POST_ASSET_IDS[0],
        cta_url: CTA_URL,
      },
      story: {
        frames: [
          { order: 1, copy: 'f1' },
          { order: 2, copy: 'f2' },
          { order: 3, copy: 'f3' },
          { order: 4, copy: 'f4' },
        ],
      },
      reel: {
        brief: 'br', script: 'sc', caption: 'cp', source_asset_ids: [], media_status: 'NO_MEDIA',
      },
      ...overrides,
    }
  }

  function fullBundles() {
    return days.map(d => completeBundle(d.date))
  }

  it('accepts a full seven-day snapshot with every day complete (Post + 4-frame Story + Reel)', () => {
    const parsed = CampaignDailyCommandSchema.safeParse({
      campaign_id: 'c0000000-0000-0000-0000-000000000000', // CTS's real id shape
      days,
      bundles: fullBundles(),
    })
    if (!parsed.success) console.error(parsed.error.issues)
    expect(parsed.success).toBe(true)
  })

  // Regression (Build Control scope shrink 5395216001, required test 1):
  // partial snapshots must be rejected — the seam no longer supports
  // per-day writes, so accepting a 1-6-bundle command would either merge
  // (deferred) or drop the other days' content silently.
  it('rejects a partial snapshot (bundles.length < 7)', () => {
    const parsed = CampaignDailyCommandSchema.safeParse({
      campaign_id: CAMPAIGN_ID,
      days,
      bundles: fullBundles().slice(0, 3),
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a snapshot with more than 7 bundles', () => {
    const parsed = CampaignDailyCommandSchema.safeParse({
      campaign_id: CAMPAIGN_ID,
      days,
      bundles: [...fullBundles(), completeBundle('2026-09-01')],
    })
    expect(parsed.success).toBe(false)
  })

  // Regression (Build Control scope shrink 5395216001, required test 2):
  // duplicate dates in bundles must be rejected — otherwise the last write
  // for a date silently overwrites the earlier one in the same snapshot.
  it('rejects a snapshot with duplicate bundle dates', () => {
    const bundles = fullBundles()
    bundles[1] = completeBundle(bundles[0].date) // two entries for the same date
    const parsed = CampaignDailyCommandSchema.safeParse({
      campaign_id: CAMPAIGN_ID,
      days,
      bundles,
    })
    expect(parsed.success).toBe(false)
  })

  // Regression (Build Control scope shrink 5395216001, required test 3):
  // bundle date set must exactly equal day date set — a bundle date not in
  // days, or a scheduled day with no matching bundle, is a mismatch that
  // renders nothing selectable in the 7-day grid.
  it('rejects a snapshot where bundle dates do not exactly match day dates (bundle outside window)', () => {
    const bundles = fullBundles()
    bundles[0] = completeBundle('2026-09-15') // outside the seven scheduled days
    const parsed = CampaignDailyCommandSchema.safeParse({
      campaign_id: CAMPAIGN_ID,
      days,
      bundles,
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a plan with fewer or more than 7 days', () => {
    const parsed = CampaignDailyCommandSchema.safeParse({
      campaign_id: CAMPAIGN_ID,
      days: days.slice(0, 6),
      bundles: fullBundles().slice(0, 6),
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a bundle whose Story does not have exactly 4 frames', () => {
    const bundles = fullBundles()
    bundles[0] = {
      ...bundles[0],
      story: { frames: [{ order: 1, copy: 'only one frame' }] },
    }
    const parsed = CampaignDailyCommandSchema.safeParse({
      campaign_id: CAMPAIGN_ID,
      days,
      bundles,
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a bundle whose Post is missing (partial-day content)', () => {
    const bundles = fullBundles()
    bundles[0] = { ...bundles[0], post: null as never }
    const parsed = CampaignDailyCommandSchema.safeParse({
      campaign_id: CAMPAIGN_ID,
      days,
      bundles,
    })
    expect(parsed.success).toBe(false)
  })

  // Regression (#1159 earlier remediation, Build Control finding 3): a
  // command must never be able to assert a Reel is READY.
  it('rejects a Reel command that declares media_status READY — WP1 cannot verify a real output', () => {
    const bundles = fullBundles()
    bundles[0] = { ...bundles[0], reel: { ...bundles[0].reel, media_status: 'READY' as never } }
    const parsed = CampaignDailyCommandSchema.safeParse({
      campaign_id: CAMPAIGN_ID,
      days,
      bundles,
    })
    expect(parsed.success).toBe(false)
  })

  it('still accepts the honest NO_MEDIA / DRAFT_MEDIA statuses for every day', () => {
    for (const media_status of ['NO_MEDIA', 'DRAFT_MEDIA']) {
      const bundles = fullBundles().map(b => ({ ...b, reel: { ...b.reel, media_status } }))
      const parsed = CampaignDailyCommandSchema.safeParse({
        campaign_id: CAMPAIGN_ID,
        days,
        bundles,
      })
      expect(parsed.success).toBe(true)
    }
  })

  // Regression (Ray-authorised remediation 5405438962, Post visual contract):
  // duplicate Post image_asset_id across days must be rejected — this is
  // exactly the "one image for seven days" review-blocker.
  it('rejects a snapshot where two days share the same Post image_asset_id', () => {
    const bundles = fullBundles()
    bundles[3] = { ...bundles[3], post: { ...bundles[3].post, image_asset_id: bundles[0].post.image_asset_id } }
    const parsed = CampaignDailyCommandSchema.safeParse({
      campaign_id: CAMPAIGN_ID,
      days,
      bundles,
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a Post with a missing image_asset_id', () => {
    const bundles = fullBundles()
    const { image_asset_id: _drop, ...postWithoutImage } = bundles[0].post as { image_asset_id: string } & Record<string, unknown>
    bundles[0] = { ...bundles[0], post: postWithoutImage as never }
    const parsed = CampaignDailyCommandSchema.safeParse({
      campaign_id: CAMPAIGN_ID,
      days,
      bundles,
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a Post with a non-HTTPS cta_url', () => {
    const bundles = fullBundles()
    bundles[0] = { ...bundles[0], post: { ...bundles[0].post, cta_url: 'http://insecure.test/tours' } }
    const parsed = CampaignDailyCommandSchema.safeParse({
      campaign_id: CAMPAIGN_ID,
      days,
      bundles,
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a Post with a malformed cta_url', () => {
    const bundles = fullBundles()
    bundles[0] = { ...bundles[0], post: { ...bundles[0].post, cta_url: 'not-a-url' } }
    const parsed = CampaignDailyCommandSchema.safeParse({
      campaign_id: CAMPAIGN_ID,
      days,
      bundles,
    })
    expect(parsed.success).toBe(false)
  })
})
