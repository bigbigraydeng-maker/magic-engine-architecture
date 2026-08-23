/**
 * Tests for the Campaign Daily Plan review slice (#1159 WP1).
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
    slots: { post: 'NOT_PLANNED', story: 'NOT_PLANNED', reel: 'NOT_PLANNED' },
  }))
}

function validCommand(overrides: Record<string, unknown> = {}) {
  return {
    campaign_id: CAMPAIGN_ID,
    days: sevenDays(),
    current_bundle: {
      date: '2026-08-24',
      post: { hook: 'hook', body: 'body copy', cta: 'Book now' },
      story: { frames: [{ order: 1, copy: 'frame one' }] },
      reel: {
        brief: 'a brief',
        script: 'a script',
        caption: 'a caption',
        source_asset_ids: [ASSET_ID],
        media_status: 'NO_MEDIA',
      },
    },
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
    expect(json.readiness.master_brief_grounding).toBe(false)
  })

  // Regression (#1159 remediation, Build Control finding 2): grounding for a
  // SAVED plan must reflect what it was actually grounded in at save time
  // (plan_data.master_brief_ref), not "does any active brief happen to exist
  // right now". Otherwise a plan saved with master_brief_ref: null falsely
  // reads as OK the moment someone later adds an active brief, even though
  // nobody re-validated that content against it.
  it('reports NEEDS_BRIEF for a saved plan whose master_brief_ref was null, even though an active brief exists NOW', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const savedWithoutBrief = {
      plan_kind: 'campaign_daily_v1',
      campaign_id: CAMPAIGN_ID,
      master_brief_ref: null, // saved before any brief existed
      days: sevenDays(),
      current_bundle: { date: '2026-08-24', post: null, story: null, reel: null },
      command_meta: { source: 'conversation_command', received_at: '2026-08-01T00:00:00.000Z', raw_summary: null },
    }
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        // an active brief exists NOW — but the saved plan predates it
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 1 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'plan-1', plan_data: savedWithoutBrief }] }) }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.grounding.status).toBe('NEEDS_BRIEF')
    expect(json.readiness.master_brief_grounding).toBe(false)
  })

  it('reports OK for a saved plan grounded in a brief that has since been superseded — the saved ref still stands', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    const savedWithOldBrief = {
      plan_kind: 'campaign_daily_v1',
      campaign_id: CAMPAIGN_ID,
      master_brief_ref: { id: 'old-brief-id', version: 1 },
      days: sevenDays(),
      current_bundle: { date: '2026-08-24', post: null, story: null, reel: null },
      command_meta: { source: 'conversation_command', received_at: '2026-08-01T00:00:00.000Z', raw_summary: null },
    }
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        // a DIFFERENT, newer brief is active now
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'new-brief-id', version: 2 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'plan-1', plan_data: savedWithOldBrief }] }) }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    // Saved plan WAS grounded (in the old brief) — that fact does not become
    // false just because the active brief has since changed.
    expect(json.grounding.status).toBe('OK')
  })

  it('reports NEEDS_CAMPAIGN — and never invents a plan — when the campaign does not resolve for this client', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(null) // wrong-client or nonexistent — getCampaignById already scopes by client_id
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 1 } }) }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.grounding.status).toBe('NEEDS_CAMPAIGN')
    expect(json.current_bundle).toBeNull()
    expect(json.days.every((d: { slots: { post: string } }) => d.slots.post === 'NOT_PLANNED')).toBe(true)
  })
})

describe('campaign-daily-plan GET — current bundle, provenance and readiness', () => {
  const persistedPlanData = {
    plan_kind: 'campaign_daily_v1',
    campaign_id: CAMPAIGN_ID,
    master_brief_ref: { id: BRIEF_ID, version: 2 },
    days: sevenDays(),
    current_bundle: {
      date: '2026-08-24',
      post: { hook: 'h', body: 'b', cta: 'Book now' },
      story: { frames: [{ order: 1, copy: 'f1' }] },
      reel: { brief: 'br', script: 'sc', caption: 'cap', source_asset_ids: [ASSET_ID], media_status: 'NO_MEDIA' },
    },
    command_meta: { source: 'conversation_command', received_at: '2026-08-24T00:00:00.000Z', raw_summary: null },
  }

  it('returns Post/Story/Reel current bundle with provenance and never claims media is ready without real output', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 2 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'plan-1', plan_data: persistedPlanData }] }) }) as never
      }
      if (table === 'client_assets') {
        return tableStub({
          in: vi.fn().mockResolvedValue({
            data: [{ id: ASSET_ID, storage_url: 'https://x/y.jpg', original_filename: 'y.jpg', source: 'stock', ownership: 'client_exclusive' }],
          }),
        }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.current_bundle.post.hook).toBe('h')
    expect(json.current_bundle.story.frames).toHaveLength(1)
    expect(json.current_bundle.reel.media_status).toBe('NO_MEDIA')
    expect(json.provenance).toEqual([
      expect.objectContaining({ id: ASSET_ID, source: 'stock' }),
    ])
    expect(json.readiness.client_asset_provenance).toBe(true)
    expect(json.readiness.format_completeness).toEqual({ post: true, story: true, reel: true })
  })

  it('flags provenance as unresolved when a referenced asset does not belong to this client', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 2 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'plan-1', plan_data: persistedPlanData }] }) }) as never
      }
      if (table === 'client_assets') {
        // client_assets query is scoped .eq('client_id', clientId) — a foreign asset simply never comes back
        return tableStub({ in: vi.fn().mockResolvedValue({ data: [] }) }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.provenance).toEqual([])
    expect(json.readiness.client_asset_provenance).toBe(false)
  })

  it('publishing plan and ad candidate are always NOT_AUTHORIZED', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 2 } }) }) as never
      }
      if (table === 'social_plans') {
        return tableStub({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'plan-1', plan_data: persistedPlanData }] }) }) as never
      }
      if (table === 'client_assets') {
        return tableStub({ in: vi.fn().mockResolvedValue({ data: [] }) }) as never
      }
      return tableStub({}) as never
    })

    const json = await (await GET(getRequest(CAMPAIGN_ID), params())).json()

    expect(json.publishing_plan.status).toBe('NOT_AUTHORIZED')
    expect(json.ad_candidate.status).toBe('NOT_AUTHORIZED')
    expect(json.readiness.provider_authorization).toBe(false)
    expect(json.readiness.publishing_authorization).toBe(false)
    expect(json.readiness.performance_outcome).toBe('UNKNOWN')
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

  // Regression (#1159 remediation, Build Control finding 3): the server must
  // never persist a caller-declared media_status of READY — WP1 has no real
  // output to verify it against, so trusting the claim would let a reviewer
  // see "可用成片（READY）" for a Reel that is still just a script.
  it('rejects a command that declares the Reel media_status is READY, before touching the database', async () => {
    allow()
    const cmd = validCommand({
      current_bundle: {
        ...validCommand().current_bundle,
        reel: { ...(validCommand().current_bundle.reel as object), media_status: 'READY' },
      },
    })

    const res = await POST(postRequest(cmd), params())

    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockGetCampaign).not.toHaveBeenCalled()
  })
})

describe('campaign-daily-plan POST — fail-closed tenant boundary', () => {
  it('rejects a campaign that does not belong to this client', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(null) // getCampaignById already scopes by client_id

    const res = await POST(postRequest(validCommand()), params())

    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('NEEDS_CAMPAIGN')
  })

  it('rejects a source asset that belongs to a different client', async () => {
    allow()
    mockGetCampaign.mockResolvedValue(CAMPAIGN)
    mockFrom.mockImplementation((table: string) => {
      if (table === 'master_briefs') {
        return tableStub({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: BRIEF_ID, version: 1 } }) }) as never
      }
      if (table === 'client_assets') {
        // only the FOREIGN_ASSET_ID was requested, and it never resolves under this client's scope
        return tableStub({ in: vi.fn().mockResolvedValue({ data: [] }) }) as never
      }
      return tableStub({}) as never
    })

    const cmd = validCommand({
      current_bundle: {
        ...validCommand().current_bundle,
        reel: { ...(validCommand().current_bundle.reel as object), source_asset_ids: [FOREIGN_ASSET_ID] },
      },
    })

    const res = await POST(postRequest(cmd), params())

    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('ASSET_NOT_OWNED_BY_CLIENT')
  })
})

describe('campaign-daily-plan POST — persists structured facts (no LLM/provider call)', () => {
  it('inserts a new campaign_daily_v1 row when none exists yet', async () => {
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
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: CTS,
        campaign_id: CAMPAIGN_ID,
        plan_data: expect.objectContaining({ plan_kind: 'campaign_daily_v1' }),
      })
    )
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
})
