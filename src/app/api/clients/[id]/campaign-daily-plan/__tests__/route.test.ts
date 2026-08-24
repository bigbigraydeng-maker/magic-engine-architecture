/**
 * Tests for the Campaign Daily Plan review slice (#1159 WP1 + 7-day remediation).
 *
 * This surface only ever reads/persists structured facts (via `social_plans`,
 * `campaign_briefs`, `master_briefs`, `client_assets`) — it never calls a
 * provider, publisher or worker. No provider/publisher/worker module is
 * imported anywhere in route.ts or daily-plan.ts (grep-verifiable), so there
 * is nothing to mock-and-assert-uncalled for those; the tests below instead
 * lock down the fail-closed tenant/grounding/asset behaviour that IS the
 * risk surface for this slice.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/content/campaign-injector', () => ({ getCampaignById: vi.fn() }))

import { GET, POST } from '../route'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { getCampaignById } from '@/lib/content/campaign-injector'

const mockAccess = vi.mocked(requireDashboardClientAccess)
const mockFrom = vi.mocked(supabaseAdmin.from)
const mockGetCampaign = vi.mocked(getCampaignById)

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const CAMPAIGN_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
const BRIEF_ID = 'bbbbbbbb-0000-0000-0000-000000000001'
const ASSET_ID = 'cccccccc-0000-0000-0000-000000000001'
const FOREIGN_ASSET_ID = 'dddddddd-0000-0000-0000-000000000001'

function params(id = CTS) {
  return { params: { id } }
}

function getRequest(campaignId?: string): NextRequest {
  const url = new URL(`http://localhost:3001/api/clients/${CTS}/campaign-daily-plan`)
  if (campaignId) url.searchParams.set('campaign_id', campaignId)
  return new NextRequest(url)
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3001/api/clients/${CTS}/campaign-daily-plan`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function allow() {
  mockAccess.mockResolvedValue({
    ok: true,
    user: { email: 'bdm@ctstours.co.nz' } as never,
    role: 'client-viewer',
    tier: 'paid_client',
    allowedClientId: CTS,
  } as never)
}

const CAMPAIGN = {
  id: CAMPAIGN_ID,
  client_id: CTS,
  status: 'active',
  title: 'CTS Facebook Daily',
  offer: null,
  primary_cta: 'Book now',
} as never

function sevenDays() {
  return Array.from({ length: 7 }, (_, i) => ({
    date: `2026-08-2${i}`,
    slots: { post: 'PLANNED', story: 'PLANNED', reel: 'PLANNED' },
  }))
}

function bundle(overrides: Record<string, unknown> = {}) {
  return {
    date: '2026-08-24',
    post: { hook: 'hook', body: 'body copy', cta: 'Book now' },
    story: {
      frames: [
        { order: 1, copy: 'frame one' },
        { order: 2, copy: 'frame two' },
        { order: 3, copy: 'frame three' },
        { order: 4, copy: 'frame four' },
      ],
    },
    reel: {
      brief: 'a brief',
      script: 'a script',
      caption: 'a caption',
      source_asset_ids: [ASSET_ID],
      media_status: 'NO_MEDIA',
    },
    ...overrides,
  }
}

/** A full seven-day snapshot (one bundle per scheduled day) — the new
 * complete-snapshot contract for POST after Build Control scope shrink
 * 5395216001. Partial commands are rejected at the schema boundary. */
function fullSevenDays() {
  return sevenDays().map(d => bundle({ date: d.date }))
}

function validCommand(overrides: Record<string, unknown> = {}) {
  return {
    campaign_id: CAMPAIGN_ID,
    days: sevenDays(),
    bundles: fullSevenDays(),
    ...overrides,
  }
}

/** Minimal chainable Supabase query builder stub for a single table. */
function tableStub(handlers: Record<string, unknown>) {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'eq', 'or', 'order', 'limit', 'in', 'contains', 'maybeSingle', 'single', 'insert', 'update']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  Object.assign(chain, handlers)
  return chain
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('campaign-daily-plan GET — authorisation', () => {
  it('rejects a caller who is not a member of the client', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)

    const res = await GET(getRequest(CAMPAIGN_ID), params(OZTOP))

    expect(res.status).toBe(403)
    expect(mockGetCampaign).not.toHaveBeenCalled()
  })

  it('will not read for an unauthenticated caller', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' } as never)

    const res = await GET(getRequest(CAMPAIGN_ID), params())

    expect(res.status).toBe(401)
  })

  it('requires campaign_id', async () => {
    allow()
    const res = await GET(getRequest(), params())
    expect(res.status).toBe(400)
  })
})

describe('campaign-daily-plan GET — grounding', () => {
  it('resolves OK when the same-client campaign and an active Master Brief both exist', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 3 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [] }) }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.grounding).toMatchObject({ status: 'OK', has_master_brief: true, has_campaign: true })
    expect(json.days).toHaveLength(7)
  })

  it('reports NEEDS_BRIEF when no active Master Brief exists for this client', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [] }) }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.grounding).toMatchObject({ status: 'NEEDS_BRIEF', has_master_brief: false })
  })

  // Regression (#1159 WP1 scope-shrink comment 5388882992, finding 1): a
  // FAILED Master Brief lookup must never be read as "no active brief" —
  // that silently reports NEEDS_BRIEF (false success) instead of surfacing
  // the real error.
  it('propagates a Master Brief lookup error as 500, never as a fabricated NEEDS_BRIEF', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'connection reset' } }) }) as never
      }
      return tableStub({}) as never
    })

    const res = await GET(getRequest(CAMPAIGN_ID), params())
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.success).toBe(false)
  })

  // Regression (#1159 remediation, Build Control finding 2): grounding for a
  // SAVED plan must reflect what it was actually grounded in at save time
  // (plan_data.master_brief_ref), not "does any active brief happen to exist
  // right now".
  it('reports NEEDS_BRIEF for a saved plan whose master_brief_ref was null, even though an active brief exists NOW', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const savedWithoutBrief = {
      plan_kind: 'campaign_daily_v1',
      campaign_id: CAMPAIGN_ID,
      master_brief_ref: null,
      days: sevenDays(),
      // A legacy row with a stored bundle that has no real content — GET must
      // still surface the plan's saved master_brief_ref, not fabricate one.
      bundles: [bundle()],
      command_meta: { source: 'conversation_command', received_at: '2026-08-01T00:00:00.000Z', raw_summary: null },
    }
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 1 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'plan-1', plan_data: savedWithoutBrief }] }) }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.grounding.status).toBe('NEEDS_BRIEF')
  })

  it('reports NEEDS_CAMPAIGN — and never invents a plan — when the campaign does not resolve for this client', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(null)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 1 } }) }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.grounding.status).toBe('NEEDS_CAMPAIGN')
    expect(json.bundles).toEqual([])
    expect(json.days.every((d: { slots: { post: string } }) => d.slots.post === 'NOT_PLANNED')).toBe(true)
  })
})

describe('campaign-daily-plan GET — multi-day bundles, provenance and readiness', () => {
  const day1 = bundle({ date: '2026-08-24' })
  const day2 = bundle({
    date: '2026-08-25',
    post: { hook: 'day 2 hook', body: 'day 2 body', cta: 'Book now' },
    story: {
      frames: [
        { order: 1, copy: 'day 2 frame' },
        { order: 2, copy: 'day 2 f2' },
        { order: 3, copy: 'day 2 f3' },
        { order: 4, copy: 'day 2 f4' },
      ],
    },
    reel: { brief: 'day 2 brief', script: 'day 2 script', caption: 'day 2 caption', source_asset_ids: [], media_status: 'NO_MEDIA' },
  })
  const persistedPlanData = {
    plan_kind: 'campaign_daily_v1',
    campaign_id: CAMPAIGN_ID,
    master_brief_ref: { id: BRIEF_ID, version: 2 },
    days: sevenDays(),
    bundles: [day1, day2],
    command_meta: { source: 'conversation_command', received_at: '2026-08-24T00:00:00.000Z', raw_summary: null },
  }

  function stubWithAssets(assetRows: unknown[]) {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 2 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'plan-1', plan_data: persistedPlanData }] }) }) as never
      }
      if (table === 'client_assets') {
        return tableStub({ in: vi.fn().mockResolvedValue({ data: assetRows }) }) as never
      }
      return tableStub({}) as never
    })
  }

  it('returns Post/Story/Reel for EVERY persisted day, not just day 1', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    stubWithAssets([{ id: ASSET_ID, storage_url: 'https://x/y.jpg', original_filename: 'y.jpg', source: 'stock', ownership: 'client_exclusive' }])

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.bundles).toHaveLength(2)
    const b1 = json.bundles.find((b: { date: string }) => b.date === '2026-08-24')
    const b2 = json.bundles.find((b: { date: string }) => b.date === '2026-08-25')
    expect(b1.post.hook).toBe('hook')
    expect(b2.post.hook).toBe('day 2 hook')
    expect(b2.story.frames[0].copy).toBe('day 2 frame')
    expect(b2.reel.media_status).toBe('NO_MEDIA')
  })

  it('computes readiness and provenance independently per day', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    stubWithAssets([{ id: ASSET_ID, storage_url: 'https://x/y.jpg', original_filename: 'y.jpg', source: 'stock', ownership: 'client_exclusive' }])

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    const b1 = json.bundles.find((b: { date: string }) => b.date === '2026-08-24')
    const b2 = json.bundles.find((b: { date: string }) => b.date === '2026-08-25')
    expect(b1.readiness.client_asset_provenance).toBe(true)
    expect(b1.provenance).toEqual([expect.objectContaining({ id: ASSET_ID })])
    expect(b2.readiness.client_asset_provenance).toBe(false)
    expect(b2.provenance).toEqual([])
  })

  it('never claims media is ready without real output, for any day', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    stubWithAssets([])

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.bundles.every((b: { reel: { media_status: string } }) => b.reel.media_status === 'NO_MEDIA')).toBe(true)
  })

  // Regression (Build Control remediation 5394505714, required test 3):
  // a day marked PLANNED with no matching bundle entry must fail honestly,
  // never silently borrow another day's (e.g. Day 1's) content.
  it('a PLANNED day with no matching bundle entry is honestly absent from `bundles`, never borrowed from another day', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const partialPlanData = { ...persistedPlanData, bundles: [day1] }
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 2 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'plan-1', plan_data: partialPlanData }] }) }) as never
      }
      if (table === 'client_assets') {
        return tableStub({ in: vi.fn().mockResolvedValue({ data: [] }) }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.bundles).toHaveLength(1)
    expect(json.bundles.find((b: { date: string }) => b.date === '2026-08-25')).toBeUndefined()
    expect(json.days.find((d: { date: string }) => d.date === '2026-08-25').slots.post).toBe('PLANNED')
  })

  it('publishing plan and ad candidate are always NOT_AUTHORIZED', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    stubWithAssets([])

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.publishing_plan.status).toBe('NOT_AUTHORIZED')
    expect(json.ad_candidate.status).toBe('NOT_AUTHORIZED')
  })
})

describe('campaign-daily-plan POST — persistence seam authorisation', () => {
  it('rejects an unauthenticated draft write', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' } as never)

    const res = await POST(postRequest(validCommand()), params())

    expect(res.status).toBe(401)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejects malformed commands before touching the database', async () => {
    allow()
    const res = await POST(postRequest({ campaign_id: 'not-a-uuid' }), params())

    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  // Regression (Build Control scope shrink 5395216001): partial snapshots
  // are rejected — the seam is now complete-seven-day only.
  it('rejects a partial snapshot (bundles.length < 7) before touching the database', async () => {
    allow()
    const bundles = fullSevenDays().slice(0, 3)
    const res = await POST(postRequest(validCommand({ bundles })), params())

    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejects a snapshot with duplicate bundle dates before touching the database', async () => {
    allow()
    const bundles = fullSevenDays()
    bundles[1] = { ...bundles[0] } // two entries for the same date
    const res = await POST(postRequest(validCommand({ bundles })), params())

    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejects a snapshot where a bundle date is not one of the seven scheduled days', async () => {
    allow()
    const bundles = fullSevenDays()
    bundles[0] = bundle({ date: '2026-09-15' }) // outside the seven scheduled days
    const res = await POST(postRequest(validCommand({ bundles })), params())

    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  // Regression (#1159 earlier remediation, Build Control finding 3): the
  // server must never persist a caller-declared media_status of READY.
  it("rejects a command that declares any day's Reel media_status is READY, before touching the database", async () => {
    allow()
    const bundles = fullSevenDays()
    bundles[0] = bundle({ reel: { ...bundle().reel, media_status: 'READY' } })
    const cmd = validCommand({ bundles })

    const res = await POST(postRequest(cmd), params())

    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockGetCampaign).not.toHaveBeenCalled()
  })
})

describe('campaign-daily-plan POST — fail-closed tenant boundary', () => {
  it('rejects a campaign that does not belong to this client', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(null)

    const res = await POST(postRequest(validCommand()), params())

    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('NEEDS_CAMPAIGN')
  })

  it('rejects a source asset that belongs to a different client, referenced from any day', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 1 } }) }) as never
      }
      if (table === 'client_assets') {
        return tableStub({ in: vi.fn().mockResolvedValue({ data: [] }) }) as never
      }
      return tableStub({}) as never
    })

    const bundles = fullSevenDays()
    bundles[1] = bundle({
      date: bundles[1].date,
      reel: { ...bundle().reel, source_asset_ids: [FOREIGN_ASSET_ID] },
    })
    const cmd = validCommand({ bundles })

    const res = await POST(postRequest(cmd), params())

    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('ASSET_NOT_OWNED_BY_CLIENT')
  })

  it('propagates a Master Brief lookup error as 500 and never touches social_plans', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const socialPlansSpy = vi.fn()
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'connection reset' } }) }) as never
      }
      if (table === 'social_plans') {
        socialPlansSpy()
        return tableStub({}) as never
      }
      return tableStub({}) as never
    })

    const res = await POST(postRequest(validCommand()), params())
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.success).toBe(false)
    expect(socialPlansSpy).not.toHaveBeenCalled()
  })
})

describe('campaign-daily-plan POST — persists structured facts (no LLM/provider call)', () => {
  it('inserts a new campaign_daily_v1 row with all seven days\' bundles', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const insertedSelect = vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'new-plan-id' }, error: null }) })
    const insert = vi.fn().mockReturnValue({ select: insertedSelect })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 1 } }) }) as never
      }
      if (table === 'client_assets') {
        return tableStub({ in: vi.fn().mockResolvedValue({ data: [{ id: ASSET_ID }] }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: null }), insert }) as never
      }
      return tableStub({}) as never
    })

    const res = await POST(postRequest(validCommand()), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.plan_id).toBe('new-plan-id')
    // Insert payload must contain all seven days' bundles, matching days[].
    const insertArg = insert.mock.calls[0][0] as { plan_data: { plan_kind: string; bundles: Array<{ date: string }>; days: Array<{ date: string }> } }
    expect(insertArg.plan_data.plan_kind).toBe('campaign_daily_v1')
    expect(insertArg.plan_data.bundles).toHaveLength(7)
    expect(insertArg.plan_data.bundles.map(b => b.date).sort())
      .toEqual(insertArg.plan_data.days.map(d => d.date).sort())
  })

  it('updates the existing campaign_daily_v1 row instead of duplicating it', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 1 } }) }) as never
      }
      if (table === 'client_assets') {
        return tableStub({ in: vi.fn().mockResolvedValue({ data: [{ id: ASSET_ID }] }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'existing-plan-id' } }), update }) as never
      }
      return tableStub({}) as never
    })

    const res = await POST(postRequest(validCommand()), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.plan_id).toBe('existing-plan-id')
    expect(update).toHaveBeenCalled()
  })

  // Regression (Build Control scope shrink 5395216001, required test 6):
  // a complete-snapshot UPDATE must REPLACE the stored bundles wholesale —
  // no preserved-old bundles carrying the new save's master_brief_ref can
  // sneak through. This removes the false-grounding and stale-window
  // risks the scope shrink is designed to eliminate.
  it('replaces the stored bundles on UPDATE — no preserved-old bundles from a previous save survive', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })

    // The old stored row includes a bundle for a date OUTSIDE the new seven-
    // day window. After a wholesale replace this old bundle must be gone.
    const previouslyStoredPlan = {
      plan_kind: 'campaign_daily_v1',
      campaign_id: CAMPAIGN_ID,
      master_brief_ref: { id: 'OLD_BRIEF_ID', version: 99 },
      days: sevenDays().map(d => ({ ...d, date: `2026-07-${(Number(d.date.slice(-1)) + 20).toString().padStart(2, '0')}` })),
      bundles: [bundle({ date: '2026-07-20' })], // outside the incoming window
      command_meta: { source: 'conversation_command', received_at: '2026-07-20T00:00:00Z', raw_summary: null },
    }
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 1 } }) }) as never
      }
      if (table === 'client_assets') {
        return tableStub({ in: vi.fn().mockResolvedValue({ data: [{ id: ASSET_ID }] }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'existing-plan-id', plan_data: previouslyStoredPlan } }),
          update,
        }) as never
      }
      return tableStub({}) as never
    })

    const res = await POST(postRequest(validCommand()), params())
    expect(res.status).toBe(200)

    const updateArg = update.mock.calls[0][0] as { plan_data: { bundles: Array<{ date: string }>, days: Array<{ date: string }> } }
    expect(updateArg.plan_data.bundles).toHaveLength(7)
    // Old preserved date is GONE.
    expect(updateArg.plan_data.bundles.find(b => b.date === '2026-07-20')).toBeUndefined()
    // Persisted bundles exactly equal the incoming days set — no elevation
    // of previously-ungrounded old bundles under the new master_brief_ref.
    expect(updateArg.plan_data.bundles.map(b => b.date).sort())
      .toEqual(updateArg.plan_data.days.map(d => d.date).sort())
  })

  // Regression (Build Control scope shrink 5395216001, required test 5):
  // GET still honours the legacy singular current_bundle field on rows
  // written before the bundles[] migration — so pre-existing production
  // rows do not silently disappear before an authorised full rewrite.
  it('GET still surfaces a legacy current_bundle row (no bundles[]) as a single-entry bundles array', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const legacyPlanData = {
      plan_kind: 'campaign_daily_v1',
      campaign_id: CAMPAIGN_ID,
      master_brief_ref: { id: BRIEF_ID, version: 2 },
      days: sevenDays(),
      // NO bundles[] — only the pre-migration singular field.
      current_bundle: bundle({ date: '2026-08-24' }),
      command_meta: { source: 'conversation_command', received_at: '2026-08-24T00:00:00.000Z', raw_summary: null },
    }
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 2 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'legacy-plan-1', plan_data: legacyPlanData }] }) }) as never
      }
      if (table === 'client_assets') {
        return tableStub({ in: vi.fn().mockResolvedValue({ data: [{ id: ASSET_ID, storage_url: 'https://x/y.jpg', original_filename: 'y.jpg', source: 'stock', ownership: 'client_exclusive' }] }) }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.bundles).toHaveLength(1)
    expect(json.bundles[0].date).toBe('2026-08-24')
    expect(json.bundles[0].post.hook).toBe('hook')
  })
})
