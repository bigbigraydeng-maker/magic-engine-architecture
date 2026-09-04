import { describe, expect, it } from 'vitest'
import {
  CampaignDailyPublishCommandSchema,
  DAILY_PLAN_POST_PUBLISHED_EVENT,
  measurementSchedule,
  partitionByIdempotency,
  publishIdempotencyKey,
  resolvePublishSchedule,
  resolvePublishStatus,
} from '../daily-plan-publish'

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const CAMPAIGN_ID = 'a0000000-0000-0000-0000-000000000001'
const PLAN_ID = 'b0000000-0000-0000-0000-000000000001'
const REVIEW_REVISION = '10000000-0000-0000-0000-000000000001'
const PLAN_REVISION = '2026-09-01T15:00:04.513Z'
const PAGE_ID = '227633594573276'

function command(overrides: Record<string, unknown> = {}) {
  return {
    client_id: CLIENT_ID,
    campaign_id: CAMPAIGN_ID,
    plan_id: PLAN_ID,
    plan_revision: PLAN_REVISION,
    review_revision: REVIEW_REVISION,
    page_id: PAGE_ID,
    approved: true,
    publish_authorization: true,
    ...overrides,
  }
}

describe('publish command — fail-closed authorisation', () => {
  it('defaults to no_publish=true when the caller says nothing', () => {
    const parsed = CampaignDailyPublishCommandSchema.parse(command())
    expect(parsed.no_publish).toBe(true)
  })

  it.each([
    ['approved', { approved: undefined }],
    ['publish_authorization', { publish_authorization: undefined }],
    ['client_id', { client_id: undefined }],
    ['plan_id', { plan_id: undefined }],
    ['plan_revision', { plan_revision: undefined }],
    ['page_id', { page_id: undefined }],
  ])('rejects a command missing %s', (_label, overrides) => {
    expect(CampaignDailyPublishCommandSchema.safeParse(command(overrides)).success).toBe(false)
  })

  it.each([
    ['approved=false', { approved: false }],
    ['publish_authorization=false', { publish_authorization: false }],
    ['approved is a truthy string', { approved: 'yes' }],
    ['publish_authorization is 1', { publish_authorization: 1 }],
  ])('rejects %s rather than coercing it to consent', (_label, overrides) => {
    expect(CampaignDailyPublishCommandSchema.safeParse(command(overrides)).success).toBe(false)
  })

  it('rejects a non-numeric page id before any provider call could happen', () => {
    expect(CampaignDailyPublishCommandSchema.safeParse(command({ page_id: 'CTSTOURS' })).success).toBe(false)
  })

  it('accepts an explicit live command only when everything is present', () => {
    const parsed = CampaignDailyPublishCommandSchema.parse(command({ no_publish: false }))
    expect(parsed.no_publish).toBe(false)
    expect(parsed.approved).toBe(true)
    expect(parsed.publish_authorization).toBe(true)
  })
})

describe('idempotency key', () => {
  const base = {
    clientId: CLIENT_ID,
    planId: PLAN_ID,
    planRevision: PLAN_REVISION,
    reviewRevision: REVIEW_REVISION,
    date: '2026-09-03',
  }

  it('is stable across attempts for the same content identity', () => {
    expect(publishIdempotencyKey(base)).toBe(publishIdempotencyKey({ ...base }))
  })

  it.each([
    ['date', { date: '2026-09-04' }],
    ['plan revision', { planRevision: '2026-09-02T00:00:00.000Z' }],
    ['review revision', { reviewRevision: '10000000-0000-0000-0000-000000000002' }],
    ['plan id', { planId: 'b0000000-0000-0000-0000-000000000002' }],
    ['client id', { clientId: 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84' }],
  ])('changes when the %s changes', (_label, overrides) => {
    expect(publishIdempotencyKey({ ...base, ...overrides })).not.toBe(publishIdempotencyKey(base))
  })
})

describe('duplicate suppression', () => {
  const a = { date: '2026-09-03', idempotency_key: 'fbpost_a' }
  const b = { date: '2026-09-04', idempotency_key: 'fbpost_b' }

  it('skips a post whose key was already published', () => {
    const { pending, skipped } = partitionByIdempotency([a, b], [{ idempotency_key: 'fbpost_a' }])
    expect(pending).toEqual([b])
    expect(skipped).toEqual([a])
  })

  it('matches on the key, not the date, so a stale receipt cannot block new copy', () => {
    const republished = { date: '2026-09-03', idempotency_key: 'fbpost_a_v2' }
    const { pending, skipped } = partitionByIdempotency([republished], [{ idempotency_key: 'fbpost_a' }])
    expect(pending).toEqual([republished])
    expect(skipped).toEqual([])
  })

  it('leaves everything pending when nothing was published before', () => {
    expect(partitionByIdempotency([a, b], []).pending).toEqual([a, b])
  })
})

describe('measurement handoff', () => {
  it('schedules T+4 (early signal) and T+72 (settled) from the real publish time', () => {
    expect(measurementSchedule('2026-09-03T00:00:00.000Z')).toEqual([
      { hours: 4, at: '2026-09-03T04:00:00.000Z' },
      { hours: 72, at: '2026-09-06T00:00:00.000Z' },
    ])
  })

  it('uses a client-agnostic event name so other clients share the workflow', () => {
    expect(DAILY_PLAN_POST_PUBLISHED_EVENT).toBe('daily_plan.post.published')
  })
})

describe('resolvePublishSchedule — the 2026-09-03 regression', () => {
  // 2026-09-03 04:00 UTC = 2026-09-03 16:00 NZST. Well before "08:00 NZ next
  // day" for any of 09-04..09-09, so all six of them should schedule.
  const NOW_MID_AFTERNOON_NZ = new Date('2026-09-03T04:00:00Z')

  it('a future NZ morning schedules — the plan does NOT fire immediately', () => {
    const r = resolvePublishSchedule('2026-09-04', NOW_MID_AFTERNOON_NZ)
    expect(r.publishNow).toBe(false)
    if (r.publishNow) return
    // 2026-09-04 08:00 NZST (winter, UTC+12) = 2026-09-03 20:00 UTC
    expect(r.scheduledPublishTime.toISOString()).toBe('2026-09-03T20:00:00.000Z')
  })

  it('all seven days spread out to seven distinct instants — no minute-apart burst', () => {
    const times = ['2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09']
      .map((d) => resolvePublishSchedule(d, NOW_MID_AFTERNOON_NZ))
      .filter((r): r is { publishNow: false; scheduledPublishTime: Date } => !r.publishNow)
      .map((r) => r.scheduledPublishTime.toISOString())
    // 09-03 08:00 NZ is already past by 16:00 NZ, so it publishes now (1 of 7 filtered out).
    expect(times).toHaveLength(6)
    expect(new Set(times).size).toBe(6)
    // Each pair is exactly 24 hours apart — the mechanism proof, not a coincidence.
    for (let i = 1; i < times.length; i++) {
      expect(new Date(times[i]).getTime() - new Date(times[i - 1]).getTime()).toBe(24 * 3600 * 1000)
    }
  })

  it('the target hour of day is 08:00 in Pacific/Auckland, not UTC', () => {
    const r = resolvePublishSchedule('2026-09-05', NOW_MID_AFTERNOON_NZ)
    if (r.publishNow) throw new Error('expected schedule')
    const nzHour = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Pacific/Auckland', hour: '2-digit', hour12: false,
    }).format(r.scheduledPublishTime)
    expect(Number(nzHour) % 24).toBe(8)
  })

  it('DST is respected: same 08:00 NZ target across the Sep 28 2026 boundary', () => {
    // Sep 27 = NZST (UTC+12); Sep 28 = NZDT (UTC+13). A fixed-offset
    // implementation would silently ship at 09:00 NZ for post-DST dates.
    const winter = resolvePublishSchedule('2026-09-27', new Date('2026-09-01T00:00:00Z'))
    const summer = resolvePublishSchedule('2026-09-29', new Date('2026-09-01T00:00:00Z'))
    if (winter.publishNow || summer.publishNow) throw new Error('expected schedules')
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Pacific/Auckland', hour: '2-digit', hour12: false,
    })
    expect(Number(fmt.format(winter.scheduledPublishTime)) % 24).toBe(8)
    expect(Number(fmt.format(summer.scheduledPublishTime)) % 24).toBe(8)
  })

  it('today publishes immediately — Facebook rejects a scheduled_publish_time within 10 minutes', () => {
    // 07:50 NZ, target is 08:00 NZ same day — only 10 minutes away, inside the guard.
    const now = new Date('2026-09-04T19:50:00Z') // 07:50 NZST on 09-04
    const r = resolvePublishSchedule('2026-09-04', now)
    expect(r.publishNow).toBe(true)
  })

  it('past dates publish immediately, they never negative-schedule', () => {
    const r = resolvePublishSchedule('2026-08-15', new Date('2026-09-03T04:00:00Z'))
    expect(r.publishNow).toBe(true)
  })

  it('a plan that says next year publishes immediately rather than getting silently dropped by Meta', () => {
    // Meta ceiling is ~6 months. A date beyond that would be a data error, not a
    // legitimate long-lead schedule. Publishing now surfaces the mistake.
    const r = resolvePublishSchedule('2027-06-01', new Date('2026-09-03T04:00:00Z'))
    expect(r.publishNow).toBe(true)
  })
})

describe('status resolution', () => {
  it.each([
    [2, 0, 'PUBLISHED'],
    [1, 1, 'PARTIAL'],
    [0, 2, 'FAILED'],
  ])('resolves %i published / %i failed to %s', (published, failed, expected) => {
    expect(resolvePublishStatus(published, failed)).toBe(expected)
  })
})
