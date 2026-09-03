import { describe, expect, it } from 'vitest'
import {
  CampaignDailyPublishCommandSchema,
  DAILY_PLAN_POST_PUBLISHED_EVENT,
  measurementSchedule,
  partitionByIdempotency,
  publishIdempotencyKey,
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
  it('schedules T+24 and T+72 from the real publish time', () => {
    expect(measurementSchedule('2026-09-03T00:00:00.000Z')).toEqual([
      { hours: 24, at: '2026-09-04T00:00:00.000Z' },
      { hours: 72, at: '2026-09-06T00:00:00.000Z' },
    ])
  })

  it('uses a client-agnostic event name so other clients share the workflow', () => {
    expect(DAILY_PLAN_POST_PUBLISHED_EVENT).toBe('daily_plan.post.published')
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
