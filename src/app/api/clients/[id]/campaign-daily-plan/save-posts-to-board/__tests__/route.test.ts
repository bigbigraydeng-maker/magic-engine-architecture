import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { CAMPAIGN_DAILY_PLAN_KIND, type CampaignDailyPlanData } from '@/lib/campaign/daily-plan'
import { refreshCampaignDailyPlan } from '@/lib/campaign/daily-plan-review'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/locale/client-locale', () => ({
  getClientLocale: vi.fn().mockResolvedValue({ timezone: 'Pacific/Auckland' }),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { POST } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockFrom = vi.mocked(supabaseAdmin.from)
const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const CAMPAIGN = 'aaaaaaaa-0000-0000-0000-000000000001'
const PLAN_ID = 'f166a5c0-b2df-478c-8b04-1168ef2d3641'
const BRIEF = 'bbbbbbbb-0000-0000-0000-000000000001'
const REVISION = '2026-08-24T03:00:00.000Z'
const CTA_URL = 'https://example.test/tours/china'
const IMAGE_IDS = Array.from(
  { length: 7 },
  (_, index) => `e000000${index + 1}-0000-0000-0000-00000000000${index + 1}`,
)

function dateAt(index: number) {
  return `2026-08-${String(24 + index).padStart(2, '0')}`
}

function storedPlan(): CampaignDailyPlanData {
  return {
    plan_kind: CAMPAIGN_DAILY_PLAN_KIND,
    campaign_id: CAMPAIGN,
    master_brief_ref: { id: BRIEF, version: 4 },
    days: Array.from({ length: 7 }, (_, index) => ({
      date: dateAt(index),
      slots: { post: 'PLANNED', story: 'PLANNED', reel: 'PLANNED' },
    })),
    bundles: Array.from({ length: 7 }, (_, index) => ({
      date: dateAt(index),
      post: {
        hook: `Hook ${index}`,
        body: `Body ${index}`,
        cta: 'Enquire Now',
        cta_url: CTA_URL,
        image_asset_id: IMAGE_IDS[index],
      },
      story: { frames: Array.from({ length: 4 }, (_, frame) => ({ order: frame + 1, copy: `Frame ${frame}` })) },
      reel: { brief: 'Brief', script: 'Script', caption: 'Caption', source_asset_ids: [], media_status: 'NO_MEDIA' },
    })),
    command_meta: { source: 'conversation_command', received_at: REVISION, raw_summary: null },
  }
}

function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest(`http://localhost/api/clients/${CLIENT}/campaign-daily-plan/save-posts-to-board`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      campaign_id: CAMPAIGN,
      plan_id: PLAN_ID,
      expected_revision: REVISION,
      start_date: '2026-09-10',
      ...overrides,
    }),
  })
}

function returning(data: unknown) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ['select', 'eq', 'contains', 'order', 'limit', 'or']) {
    query[method] = vi.fn(() => query)
  }
  query.maybeSingle = vi.fn().mockResolvedValue({ data, error: null })
  return query
}

function installSuccessfulDb(options: {
  postCollision?: boolean
  refreshCasLosesTo?: CampaignDailyPlanData
} = {}) {
  let plan: CampaignDailyPlanData = storedPlan()
  const postStore = new Map<string, Record<string, unknown>>()
  const visualStore = new Map<string, Record<string, unknown>>()

  mockFrom.mockImplementation((table: string) => {
    if (table === 'social_plans') {
      const query = returning({ id: PLAN_ID, client_id: CLIENT, campaign_id: CAMPAIGN, plan_data: plan, created_at: REVISION })
      query.update = vi.fn((payload: { plan_data: CampaignDailyPlanData }) => {
        if (options.refreshCasLosesTo) {
          plan = options.refreshCasLosesTo
        } else {
          plan = payload.plan_data
        }
        const updateQuery = returning(options.refreshCasLosesTo ? null : { id: PLAN_ID })
        updateQuery.is = vi.fn(() => updateQuery)
        return updateQuery
      })
      return query as never
    }
    if (table === 'campaign_briefs') {
      return returning({
        id: CAMPAIGN,
        client_id: CLIENT,
        status: 'active',
        source_urls: [CTA_URL],
        valid_from: '2026-01-01',
        valid_until: '2026-12-31',
        updated_at: '2026-08-20T00:00:00.000Z',
      }) as never
    }
    if (table === 'master_briefs') {
      return returning({ id: BRIEF, version: 4, updated_at: '2026-08-20T00:00:00.000Z' }) as never
    }
    if (table === 'client_assets') {
      const query = returning(null)
      query.in = vi.fn().mockResolvedValue({
        data: IMAGE_IDS.map((id, index) => ({
          id,
          client_id: CLIENT,
          storage_url: `https://cdn.test/${index}.jpg`,
          original_filename: `${index}.jpg`,
          status: 'analyzed',
          archived_at: null,
          mime_type: 'image/jpeg',
        })),
        error: null,
      })
      return query as never
    }
    if (table === 'content_posts') {
      return {
        upsert: vi.fn((rows: Array<Record<string, unknown>>) => {
          const inserted = rows.filter(row => !postStore.has(row.id as string))
          for (const row of inserted) postStore.set(row.id as string, row)
          return { select: vi.fn().mockResolvedValue({ data: inserted, error: null }) }
        }),
        select: vi.fn(() => ({
          in: vi.fn((_: string, ids: string[]) => Promise.resolve({
            data: ids.map((id, index) => {
              const row = postStore.get(id)!
              return {
                ...row,
                client_id: options.postCollision && index === 0
                  ? 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
                  : row.client_id,
              }
            }),
            error: null,
          })),
        })),
      } as never
    }
    if (table === 'visual_assets') {
      return {
        upsert: vi.fn((rows: Array<Record<string, unknown>>) => {
          const inserted = rows.filter(row => !visualStore.has(row.id as string))
          for (const row of inserted) visualStore.set(row.id as string, row)
          return { select: vi.fn().mockResolvedValue({ data: inserted, error: null }) }
        }),
        select: vi.fn(() => ({
          in: vi.fn((_: string, ids: string[]) => Promise.resolve({
            data: ids.map(id => ({ ...visualStore.get(id)! })),
            error: null,
          })),
        })),
      } as never
    }
    throw new Error(`Unexpected table ${table}`)
  })

  return {
    getPlan: () => plan,
    setPlan: (next: CampaignDailyPlanData) => { plan = next },
    getPostRows: () => Array.from(postStore.values()),
    getVisualRows: () => Array.from(visualStore.values()),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'))
  mockAccess.mockResolvedValue({ ok: true, tier: 'paid_client' } as never)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('campaign daily Post review handoff', () => {
  it('authenticates before any database read', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)
    const response = await POST(request(), { params: { id: CLIENT } })
    expect(response.status).toBe(403)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('refreshes dates and creates exactly seven draft Posts plus seven client-library images', async () => {
    const db = installSuccessfulDb()
    const response = await POST(request(), { params: { id: CLIENT } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.posts).toMatchObject({ created: 7, existing: 0 })
    expect(body.images_linked).toBe(7)
    expect(body.publishing_authorization).toBe('NOT_AUTHORIZED')
    expect(db.getPlan().days.map(day => day.date)).toEqual([
      '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16',
    ])
    expect(db.getPostRows()).toHaveLength(7)
    expect(db.getPostRows().every(row => row.status === 'draft' && row.scheduled_at === null)).toBe(true)
    expect(db.getVisualRows()).toHaveLength(7)
    expect(db.getVisualRows().every(row => row.provider === 'client_library' && row.generation_status === 'ready')).toBe(true)
  })

  it('retries the same plan idempotently without creating a second seven-row set', async () => {
    installSuccessfulDb()
    const first = await POST(request(), { params: { id: CLIENT } })
    const second = await POST(request(), { params: { id: CLIENT } })
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect((await second.json()).posts).toMatchObject({ created: 0, existing: 7 })
  })

  it('concurrent duplicate requests converge on one seven-row Post and image set', async () => {
    const db = installSuccessfulDb()
    const [left, right] = await Promise.all([
      POST(request(), { params: { id: CLIENT } }),
      POST(request(), { params: { id: CLIENT } }),
    ])
    expect(left.status).toBe(200)
    expect(right.status).toBe(200)
    expect(db.getPostRows()).toHaveLength(7)
    expect(db.getVisualRows()).toHaveLength(7)
  })

  it('rejects a different second window for the same plan identity', async () => {
    installSuccessfulDb()
    expect((await POST(request(), { params: { id: CLIENT } })).status).toBe(200)
    const conflict = await POST(request({ start_date: '2026-09-20' }), { params: { id: CLIENT } })
    expect(conflict.status).toBe(409)
    expect((await conflict.json()).error).toBe('PLAN_ALREADY_HANDED_OFF')
  })

  it('rejects a same-date CAS winner from a different command revision before any review row write', async () => {
    const competing = storedPlan()
    competing.command_meta.received_at = '2026-09-01T00:00:00.000Z'
    const competingRefresh = refreshCampaignDailyPlan(
      competing,
      '2026-09-10',
      '2026-09-02T00:00:00.000Z',
    )
    const db = installSuccessfulDb({ refreshCasLosesTo: competingRefresh })

    const response = await POST(request(), { params: { id: CLIENT } })

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('PLAN_REFRESH_CONFLICT')
    expect(db.getPostRows()).toEqual([])
    expect(db.getVisualRows()).toEqual([])
  })

  it('detects a Post identity collision before linking any image', async () => {
    const db = installSuccessfulDb({ postCollision: true })
    const response = await POST(request(), { params: { id: CLIENT } })
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('LINEAGE_ID_COLLISION')
    expect(db.getVisualRows()).toEqual([])
  })

  it('creates a fresh seven-row identity for a new command revision on the same plan id', async () => {
    const db = installSuccessfulDb()
    expect((await POST(request(), { params: { id: CLIENT } })).status).toBe(200)

    const nextPlan = storedPlan()
    nextPlan.command_meta.received_at = '2026-09-01T00:00:00.000Z'
    nextPlan.bundles[0].post!.hook = 'New revision hook'
    db.setPlan(nextPlan)
    const second = await POST(request({
      expected_revision: nextPlan.command_meta.received_at,
      start_date: '2026-09-20',
    }), { params: { id: CLIENT } })
    expect(second.status).toBe(200)
    expect((await second.json()).posts).toMatchObject({ created: 7, existing: 0 })
    expect(db.getPostRows()).toHaveLength(14)
    expect(db.getVisualRows()).toHaveLength(14)
  })
})
