import { describe, expect, it } from 'vitest'
import { CAMPAIGN_DAILY_PLAN_KIND, type CampaignDailyPlanData } from './daily-plan'
import {
  addCalendarDays,
  assertCompleteConsecutiveWindow,
  campaignDailyReviewStableKey,
  dateInTimeZone,
  deterministicReviewUuid,
  isRealIsoDate,
  refreshCampaignDailyPlan,
} from './daily-plan-review'

const PLAN: CampaignDailyPlanData = {
  plan_kind: CAMPAIGN_DAILY_PLAN_KIND,
  campaign_id: 'aaaaaaaa-0000-0000-0000-000000000001',
  master_brief_ref: { id: 'bbbbbbbb-0000-0000-0000-000000000001', version: 3 },
  days: Array.from({ length: 7 }, (_, index) => ({
    date: addCalendarDays('2026-08-24', index),
    slots: { post: 'PLANNED', story: 'PLANNED', reel: 'PLANNED' },
  })),
  bundles: Array.from({ length: 7 }, (_, index) => ({
    date: addCalendarDays('2026-08-24', index),
    post: {
      hook: `hook ${index}`,
      body: `body ${index}`,
      cta: 'Enquire Now',
      image_asset_id: `e000000${index + 1}-0000-0000-0000-00000000000${index + 1}`,
      cta_url: 'https://example.test/tour',
    },
    story: { frames: Array.from({ length: 4 }, (_, frame) => ({ order: frame + 1, copy: `frame ${frame}` })) },
    reel: { brief: `brief ${index}`, script: `script ${index}`, caption: `caption ${index}`, source_asset_ids: [], media_status: 'NO_MEDIA' },
  })),
  command_meta: {
    source: 'conversation_command',
    received_at: '2026-08-24T00:00:00.000Z',
    raw_summary: 'original command',
  },
}

describe('campaign daily review helpers', () => {
  it('rejects impossible dates and handles month/year boundaries by calendar day', () => {
    expect(isRealIsoDate('2026-02-30')).toBe(false)
    expect(isRealIsoDate('2028-02-29')).toBe(true)
    expect(addCalendarDays('2026-12-29', 6)).toBe('2027-01-04')
  })

  it('uses the client timezone calendar date rather than UTC', () => {
    const instant = new Date('2026-09-01T12:30:00.000Z')
    expect(dateInTimeZone(instant, 'Pacific/Auckland')).toBe('2026-09-02')
    expect(dateInTimeZone(instant, 'Australia/Perth')).toBe('2026-09-01')
  })

  it('changes only day/bundle dates and adds refresh metadata', () => {
    const refreshed = refreshCampaignDailyPlan(PLAN, '2026-09-10', '2026-09-02T00:00:00.000Z')

    expect(refreshed.days.map(day => day.date)).toEqual(
      Array.from({ length: 7 }, (_, index) => addCalendarDays('2026-09-10', index)),
    )
    expect(refreshed.bundles.map(bundle => bundle.date)).toEqual(refreshed.days.map(day => day.date))
    expect(refreshed.bundles.map(({ date: _date, ...bundle }) => bundle)).toEqual(
      PLAN.bundles.map(({ date: _date, ...bundle }) => bundle),
    )
    expect(refreshed.master_brief_ref).toEqual(PLAN.master_brief_ref)
    expect(refreshed.command_meta).toEqual(PLAN.command_meta)
    expect(refreshed.refresh_meta.original_dates).toEqual(PLAN.days.map(day => day.date))
  })

  it('fails closed on a non-consecutive or reordered stored window', () => {
    const brokenDays = PLAN.days.map(day => ({ ...day }))
    brokenDays[3].date = '2026-09-30'
    expect(() => assertCompleteConsecutiveWindow(brokenDays, PLAN.bundles)).toThrow('PLAN_DATES_NOT_CONSECUTIVE')
  })

  it('keeps deterministic plan/day identities stable across date refreshes', () => {
    const stableKey = campaignDailyReviewStableKey({
      clientId: 'c0000000-0000-0000-0000-000000000000',
      planId: 'f166a5c0-b2df-478c-8b04-1168ef2d3641',
      planRevision: '2026-08-24T00:00:00.000Z',
      dayIndex: 0,
    })
    expect(deterministicReviewUuid('post', stableKey)).toBe(deterministicReviewUuid('post', stableKey))
    expect(deterministicReviewUuid('post', stableKey)).not.toBe(deterministicReviewUuid('image', stableKey))
    expect(deterministicReviewUuid('post', stableKey)).toMatch(/^[0-9a-f-]{36}$/)

    const nextRevision = campaignDailyReviewStableKey({
      clientId: 'c0000000-0000-0000-0000-000000000000',
      planId: 'f166a5c0-b2df-478c-8b04-1168ef2d3641',
      planRevision: '2026-09-01T00:00:00.000Z',
      dayIndex: 0,
    })
    expect(deterministicReviewUuid('post', nextRevision)).not.toBe(deterministicReviewUuid('post', stableKey))
  })
})
