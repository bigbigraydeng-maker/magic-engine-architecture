import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/workflows/inngest-event', () => ({ sendInngestEvent: vi.fn() }))
vi.mock('@/lib/meta/token-manager', () => ({
  getMetaTokenForClient: vi.fn(),
  getStoredPageToken: vi.fn(),
}))
vi.mock('@/lib/meta/page-posts', () => ({
  getPageAccessToken: vi.fn(),
  publishPagePhotoPost: vi.fn(),
}))

import { POST } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { getMetaTokenForClient, getStoredPageToken } from '@/lib/meta/token-manager'
import { getPageAccessToken, publishPagePhotoPost } from '@/lib/meta/page-posts'
import { publishIdempotencyKey } from '@/lib/campaign/daily-plan-publish'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockFrom = vi.mocked(supabaseAdmin.from)
const mockSendInngestEvent = vi.mocked(sendInngestEvent)
const mockGetMetaToken = vi.mocked(getMetaTokenForClient)
const mockGetStoredPageToken = vi.mocked(getStoredPageToken)
const mockGetPageToken = vi.mocked(getPageAccessToken)
const mockPublish = vi.mocked(publishPagePhotoPost)

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const CAMPAIGN_ID = 'a0000000-0000-0000-0000-000000000001'
const PLAN_ID = 'b0000000-0000-0000-0000-000000000001'
const USER_ID = 'f0000000-0000-0000-0000-000000000001'
const PLAN_REVISION = '2026-09-01T15:00:04.513Z'
const REVIEW_REVISION = '10000000-0000-0000-0000-000000000001'
const PAGE_ID = '227633594573276'
const DATES = ['2026-09-03', '2026-09-04']
const ASSETS = ['e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002']

function keyFor(date: string) {
  return publishIdempotencyKey({
    clientId: CLIENT_ID,
    planId: PLAN_ID,
    planRevision: PLAN_REVISION,
    reviewRevision: REVIEW_REVISION,
    date,
  })
}

function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest(`http://localhost/api/clients/${CLIENT_ID}/campaign-daily-plan/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      campaign_id: CAMPAIGN_ID,
      plan_id: PLAN_ID,
      plan_revision: PLAN_REVISION,
      review_revision: REVIEW_REVISION,
      page_id: PAGE_ID,
      approved: true,
      publish_authorization: true,
      ...overrides,
    }),
  })
}

const params = { params: { id: CLIENT_ID } }

function queueReceipt() {
  return {
    schema_version: 1,
    event_name: 'daily_plan.publish_queue.ready',
    event_id: 'evt_queue_1',
    request_id: '20000000-0000-0000-0000-000000000001',
    plan_revision: PLAN_REVISION,
    review_revision: REVIEW_REVISION,
    status: 'READY_NO_PUBLISH',
    no_publish: true,
    publishing_authorization: 'NOT_AUTHORIZED',
    provider_impact: 'NONE',
    cost_usd: 0,
    created_at: '2026-09-01T15:10:00.000Z',
    created_by_user_id: USER_ID,
    posts: DATES.map((date, index) => ({
      date,
      image_asset_id: ASSETS[index],
      cta_url: 'https://ctstours.co.nz/tours/china-classic',
      review_verdict: 'PASS',
    })),
  }
}

function planData(overrides: Record<string, unknown> = {}) {
  return {
    plan_kind: 'campaign_daily_v1',
    campaign_id: CAMPAIGN_ID,
    master_brief_ref: null,
    days: DATES.map(date => ({ date, slots: { post: 'PLANNED', story: 'PLANNED', reel: 'PLANNED' } })),
    bundles: DATES.map((date, index) => ({
      date,
      post: {
        hook: `Hook ${index + 1}`,
        body: `Body ${index + 1}`,
        cta: 'Enquire now',
        cta_url: 'https://ctstours.co.nz/tours/china-classic',
        image_asset_id: ASSETS[index],
      },
      story: null,
      reel: null,
    })),
    command_meta: { source: 'conversation_command', received_at: PLAN_REVISION, raw_summary: null },
    review_meta: {
      schema_version: 1,
      plan_revision: PLAN_REVISION,
      revision: REVIEW_REVISION,
      updated_at: '2026-09-01T15:05:00.000Z',
      posts: Object.fromEntries(DATES.map(date => [date, {
        verdict: 'PASS',
        reason: null,
        reviewed_at: '2026-09-01T15:05:00.000Z',
        reviewed_by_user_id: USER_ID,
      }])),
    },
    publish_queue_meta: queueReceipt(),
    ...overrides,
  }
}

/**
 * One table's query handle. `terminal` is the method that actually awaits for
 * that table's query in the route, so a shape change in the route surfaces as
 * a failing test instead of a silently pending promise.
 */
function chain(result: unknown, terminal: 'limit' | 'in' | 'maybeSingle') {
  const query: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'contains', 'order', 'limit', 'in', 'is', 'update', 'maybeSingle']) {
    query[method] = vi.fn().mockReturnValue(query)
  }
  query[terminal] = vi.fn().mockResolvedValue(result)
  return query
}

interface TableState {
  plan?: Record<string, unknown>
  assets?: unknown[]
  facebookPageId?: string | null
  updateResult?: unknown
}

let updateSpy: ReturnType<typeof vi.fn>

/** Fake Supabase modelled by TABLE, not by call order. */
function stubTables(state: TableState = {}) {
  const plan = state.plan ?? planData()
  const assets = state.assets ?? ASSETS.map(id => ({
    id,
    storage_url: `https://assets.test/${id}.jpg`,
    mime_type: 'image/jpeg',
    status: 'analyzed',
    archived_at: null,
  }))
  updateSpy = vi.fn()

  mockFrom.mockImplementation(((table: string) => {
    if (table === 'client_assets') return chain({ data: assets, error: null }, 'in')
    if (table === 'clients') {
      return chain({ data: { facebook_page_id: state.facebookPageId ?? PAGE_ID }, error: null }, 'maybeSingle')
    }
    if (table === 'social_plans') {
      const read = chain({ data: [{ id: PLAN_ID, plan_data: plan, created_at: PLAN_REVISION }], error: null }, 'limit')
      const write = chain(state.updateResult ?? { data: { id: PLAN_ID }, error: null }, 'maybeSingle')
      // `update()` marks this handle as the write path and records the payload.
      read.update = vi.fn().mockImplementation((payload: unknown) => {
        updateSpy(payload)
        return write
      })
      return read
    }
    throw new Error(`unexpected table ${table}`)
  }) as never)
}

function allow() {
  mockAccess.mockResolvedValue({
    ok: true,
    user: { id: USER_ID, email: 'ray@example.test' },
    role: 'admin',
    tier: 'admin',
    allowedClientId: null,
  } as never)
}

function armProvider() {
  mockGetStoredPageToken.mockResolvedValue('stored-page-token')
  mockGetMetaToken.mockResolvedValue('user-token')
  mockGetPageToken.mockResolvedValue('page-token')
  mockSendInngestEvent.mockResolvedValue({ event_ids: ['evt_pub_1'] })
  let counter = 0
  mockPublish.mockImplementation(async () => {
    counter += 1
    return {
      postId: `${PAGE_ID}_9${counter}`,
      postIdSource: 'post_id' as const,
      permalink: `https://www.facebook.com/${PAGE_ID}_9${counter}`,
      raw: { id: `photo_${counter}`, post_id: `${PAGE_ID}_9${counter}` },
    }
  })
}

beforeEach(() => {
  allow()
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('publish bridge — fail-closed authorisation', () => {
  it.each([
    ['approved missing', { approved: undefined }],
    ['publish_authorization missing', { publish_authorization: undefined }],
    ['approved false', { approved: false }],
    ['publish_authorization false', { publish_authorization: false }],
    ['page_id missing', { page_id: undefined }],
    ['plan_revision missing', { plan_revision: undefined }],
  ])('refuses (%s) before touching the database or Facebook', async (_label, overrides) => {
    const response = await POST(request(overrides), params)

    expect(response.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()
    expect(mockGetMetaToken).not.toHaveBeenCalled()
    expect(mockSendInngestEvent).not.toHaveBeenCalled()
  })

  it('refuses when the body client_id disagrees with the path', async () => {
    const response = await POST(request({ client_id: 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84' }), params)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('CLIENT_ID_MISMATCH')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('refuses when the caller lacks paid client access', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'nope', reason: 'paid_only' } as never)

    const response = await POST(request({ no_publish: false }), params)

    expect(response.status).toBe(403)
    expect(mockPublish).not.toHaveBeenCalled()
  })
})

describe('publish bridge — dry run is the default', () => {
  it('performs no provider call, no event and no write when no_publish is omitted', async () => {
    stubTables()

    const response = await POST(request(), params)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.status).toBe('DRY_RUN')
    expect(json.provider_impact).toBe('NONE')
    expect(json.would_publish.map((p: { date: string }) => p.date)).toEqual(DATES)
    expect(json.would_publish[0].idempotency_key).toBe(keyFor(DATES[0]))
    expect(mockPublish).not.toHaveBeenCalled()
    expect(mockSendInngestEvent).not.toHaveBeenCalled()
    expect(mockGetMetaToken).not.toHaveBeenCalled()
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('reports already-published dates as duplicates instead of re-listing them', async () => {
    stubTables({
      plan: planData({
        publish_meta: {
          schema_version: 1,
          event_name: 'daily_plan.post.published',
          status: 'PARTIAL',
          request_id: '30000000-0000-0000-0000-000000000001',
          client_id: CLIENT_ID,
          campaign_id: CAMPAIGN_ID,
          plan_id: PLAN_ID,
          plan_revision: PLAN_REVISION,
          review_revision: REVIEW_REVISION,
          page_id: PAGE_ID,
          publishing_authorization: 'AUTHORIZED',
          approved_by_user_id: USER_ID,
          created_at: '2026-09-02T00:00:00.000Z',
          published: [{
            date: DATES[0],
            idempotency_key: keyFor(DATES[0]),
            post_id: `${PAGE_ID}_11`,
            post_id_source: 'post_id',
            page_id: PAGE_ID,
            published_at: '2026-09-02T00:00:00.000Z',
            permalink: `https://www.facebook.com/${PAGE_ID}_11`,
            provider_response: {},
          }],
          failed: [],
          event_ids: ['evt_old'],
        },
      }),
    })

    const json = await (await POST(request(), params)).json()

    expect(json.would_publish.map((p: { date: string }) => p.date)).toEqual([DATES[1]])
    expect(json.already_published.map((p: { date: string }) => p.date)).toEqual([DATES[0]])
  })
})

describe('publish bridge — review chain is mandatory', () => {
  it('refuses to publish a plan that never got a no-publish queue receipt', async () => {
    const plan = planData()
    delete (plan as Record<string, unknown>).publish_queue_meta
    stubTables({ plan })

    const response = await POST(request({ no_publish: false }), params)

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('PUBLISH_QUEUE_RECEIPT_REQUIRED')
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('refuses when the reviewer approved a different revision than the caller names', async () => {
    stubTables()

    const response = await POST(
      request({ no_publish: false, review_revision: '10000000-0000-0000-0000-000000000009' }),
      params
    )

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('REVIEW_REVISION_MISMATCH')
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('refuses a date that is not in the reviewed set', async () => {
    stubTables()

    const response = await POST(request({ no_publish: false, dates: ['2026-09-30'] }), params)

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('DATE_NOT_IN_REVIEWED_SET')
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('refuses when the caller names a Page the client is not registered against', async () => {
    stubTables({ facebookPageId: '999999999999999' })
    armProvider()

    const response = await POST(request({ no_publish: false }), params)

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('PAGE_ID_MISMATCH')
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('refuses with a status a CDN will pass through when no Page token resolves', async () => {
    stubTables()
    mockGetStoredPageToken.mockResolvedValue(null)
    mockGetMetaToken.mockResolvedValue('user-token')
    mockGetPageToken.mockResolvedValue(null)

    const response = await POST(request({ no_publish: false }), params)
    const json = await response.json()

    // Never 502/504: a proxy replaces those bodies with its own error page,
    // which is exactly how this refusal once reached the browser as
    // "Bad gateway" with the real reason stripped out.
    expect([502, 504]).not.toContain(response.status)
    expect(response.status).toBe(424)
    expect(json.error).toBe('PAGE_TOKEN_UNAVAILABLE')
    expect(json.detail).toContain('重新授权')
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('says plainly when the client has no Meta token configured at all', async () => {
    stubTables()
    mockGetStoredPageToken.mockResolvedValue(null)
    mockGetMetaToken.mockResolvedValue(null)

    const response = await POST(request({ no_publish: false }), params)
    const json = await response.json()

    expect(response.status).toBe(424)
    expect(json.detail).toContain('既没有存下来的主页授权，也没有配置 Meta 令牌')
    expect(mockPublish).not.toHaveBeenCalled()
  })
})

describe('publish bridge — token source', () => {
  it('uses the stored Page authorisation and never touches the hand-pasted token', async () => {
    stubTables()
    armProvider()

    await POST(request({ no_publish: false, dates: [DATES[0]] }), params)

    expect(mockGetStoredPageToken).toHaveBeenCalledWith(CLIENT_ID, PAGE_ID)
    expect(mockGetMetaToken).not.toHaveBeenCalled()
    expect(mockPublish.mock.calls[0][0].pageAccessToken).toBe('stored-page-token')
  })

  it('falls back to the env token only when nothing is stored', async () => {
    stubTables()
    armProvider()
    mockGetStoredPageToken.mockResolvedValue(null)

    await POST(request({ no_publish: false, dates: [DATES[0]] }), params)

    expect(mockGetMetaToken).toHaveBeenCalledWith(CLIENT_ID)
    expect(mockPublish.mock.calls[0][0].pageAccessToken).toBe('page-token')
  })

  it('tells the reader to re-authorise, naming where the button is', async () => {
    stubTables()
    mockGetStoredPageToken.mockResolvedValue(null)
    mockGetMetaToken.mockResolvedValue('user-token')
    mockGetPageToken.mockResolvedValue(null)

    const json = await (await POST(request({ no_publish: false }), params)).json()

    expect(json.detail).toContain('平台连接')
    expect(json.detail).toContain('连接 Meta')
  })
})

describe('publish bridge — live run records real provider ids', () => {
  it('publishes each reviewed Post once and stores the real ids', async () => {
    stubTables()
    armProvider()

    const response = await POST(request({ no_publish: false }), params)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.status).toBe('PUBLISHED')
    expect(mockPublish).toHaveBeenCalledTimes(2)
    expect(json.receipt.published.map((p: { post_id: string }) => p.post_id)).toEqual([
      `${PAGE_ID}_91`,
      `${PAGE_ID}_92`,
    ])
    expect(json.receipt.published[0].page_id).toBe(PAGE_ID)
    expect(json.receipt.published[0].published_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(json.receipt.published[0].provider_response).toEqual({ id: 'photo_1', post_id: `${PAGE_ID}_91` })
    expect(json.receipt.publishing_authorization).toBe('AUTHORIZED')
    expect(json.receipt.approved_by_user_id).toBe(USER_ID)
  })

  it('sends the caption built from the reviewed copy, not from caller input', async () => {
    stubTables()
    armProvider()

    await POST(request({ no_publish: false, dates: [DATES[0]] }), params)

    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(mockPublish.mock.calls[0][0]).toMatchObject({
      pageId: PAGE_ID,
      pageAccessToken: 'stored-page-token',
      imageUrl: `https://assets.test/${ASSETS[0]}.jpg`,
      message: 'Hook 1\n\nBody 1\n\nEnquire now: https://ctstours.co.nz/tours/china-classic',
    })
  })

  it('emits one measurement event per Post with T+4/T+72 and the idempotency key', async () => {
    stubTables()
    armProvider()

    await POST(request({ no_publish: false, dates: [DATES[0]] }), params)

    expect(mockSendInngestEvent).toHaveBeenCalledTimes(1)
    const event = mockSendInngestEvent.mock.calls[0][0]
    expect(event.name).toBe('daily_plan.post.published')
    expect(event.id).toBe(keyFor(DATES[0]))
    expect(event.data).toMatchObject({
      client_id: CLIENT_ID,
      plan_id: PLAN_ID,
      date: DATES[0],
      post_id: `${PAGE_ID}_91`,
      page_id: PAGE_ID,
      measure_at: [
        { hours: 4, at: expect.any(String) },
        { hours: 72, at: expect.any(String) },
      ],
    })
  })

  it('persists the receipt onto the plan snapshot', async () => {
    stubTables()
    armProvider()

    await POST(request({ no_publish: false }), params)

    expect(updateSpy).toHaveBeenCalledTimes(1)
    const written = updateSpy.mock.calls[0][0] as { plan_data: { publish_meta: { published: unknown[] } } }
    expect(written.plan_data.publish_meta.published).toHaveLength(2)
  })

  it('keeps going after one Post fails and reports PARTIAL', async () => {
    stubTables()
    armProvider()
    mockPublish.mockReset()
    mockPublish
      .mockRejectedValueOnce(new Error('publishPagePhotoPost: image url unreachable'))
      .mockResolvedValueOnce({
        postId: `${PAGE_ID}_93`,
        postIdSource: 'post_id',
        permalink: `https://www.facebook.com/${PAGE_ID}_93`,
        raw: { post_id: `${PAGE_ID}_93` },
      } as never)

    const json = await (await POST(request({ no_publish: false }), params)).json()

    expect(json.status).toBe('PARTIAL')
    expect(json.success).toBe(false)
    expect(json.receipt.failed).toHaveLength(1)
    expect(json.receipt.failed[0].date).toBe(DATES[0])
    expect(json.receipt.published).toHaveLength(1)
    expect(json.receipt.published[0].post_id).toBe(`${PAGE_ID}_93`)
  })

  it('never posts a Post whose idempotency key is already on the receipt', async () => {
    stubTables({
      plan: planData({
        publish_meta: {
          schema_version: 1,
          event_name: 'daily_plan.post.published',
          status: 'PARTIAL',
          request_id: '30000000-0000-0000-0000-000000000001',
          client_id: CLIENT_ID,
          campaign_id: CAMPAIGN_ID,
          plan_id: PLAN_ID,
          plan_revision: PLAN_REVISION,
          review_revision: REVIEW_REVISION,
          page_id: PAGE_ID,
          publishing_authorization: 'AUTHORIZED',
          approved_by_user_id: USER_ID,
          created_at: '2026-09-02T00:00:00.000Z',
          published: [{
            date: DATES[0],
            idempotency_key: keyFor(DATES[0]),
            post_id: `${PAGE_ID}_11`,
            post_id_source: 'post_id',
            page_id: PAGE_ID,
            published_at: '2026-09-02T00:00:00.000Z',
            permalink: `https://www.facebook.com/${PAGE_ID}_11`,
            provider_response: {},
          }],
          failed: [],
          event_ids: ['evt_old'],
        },
      }),
    })
    armProvider()

    const json = await (await POST(request({ no_publish: false }), params)).json()

    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(mockPublish.mock.calls[0][0].message).toContain('Hook 2')
    expect(json.skipped_as_duplicate.map((p: { date: string }) => p.date)).toEqual([DATES[0]])
    expect(json.receipt.published).toHaveLength(2)
    expect(json.receipt.event_ids).toEqual(['evt_old', 'evt_pub_1'])
  })

  it('hands back the real post ids even when the receipt cannot be stored', async () => {
    stubTables({ updateResult: { data: null, error: null } })
    armProvider()

    const response = await POST(request({ no_publish: false }), params)
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error).toBe('PUBLISH_RECEIPT_NOT_PERSISTED')
    expect(json.receipt.published.map((p: { post_id: string }) => p.post_id)).toEqual([
      `${PAGE_ID}_91`,
      `${PAGE_ID}_92`,
    ])
  })

  it('still returns the post id when the measurement event fails to send', async () => {
    stubTables()
    armProvider()
    mockSendInngestEvent.mockRejectedValue(new Error('INNGEST_EVENT_KEY_MISSING'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const json = await (await POST(request({ no_publish: false, dates: [DATES[0]] }), params)).json()

    expect(json.status).toBe('PUBLISHED')
    expect(json.receipt.published[0].post_id).toBe(`${PAGE_ID}_91`)
    expect(json.receipt.event_ids).toEqual([])
  })
})
