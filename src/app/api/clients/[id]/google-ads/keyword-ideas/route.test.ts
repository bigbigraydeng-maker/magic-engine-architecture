/**
 * POST /api/clients/[id]/google-ads/keyword-ideas — route tests.
 *
 * Pins the auth → body-validation → creds-lookup → API-call → response chain
 * so a downstream refactor of any of those can't quietly break the
 * client-facing contract (400 vs 424 vs 502 must stay distinct so operators
 * know whether to check request shape, client onboarding, or Google API health).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

// ── Auth mock ─────────────────────────────────────────────────────────────────

const mockRequireAccess = vi.fn()
vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: (...args: unknown[]) => mockRequireAccess(...args),
}))

// ── Supabase mock (route imports supabaseAdmin but only passes it through) ────

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { __mock: true },
}))

// ── Creds loader mock ─────────────────────────────────────────────────────────

const mockLoadCreds = vi.fn()
vi.mock('@/lib/google-ads/creds-loader', () => ({
  loadGoogleAdsCredsForClient: (...args: unknown[]) => mockLoadCreds(...args),
}))

// ── Keyword-planner mock ──────────────────────────────────────────────────────

const mockGenerateIdeas = vi.fn()
vi.mock('@/lib/google-ads/keyword-planner', () => ({
  generateKeywordIdeas: (...args: unknown[]) => mockGenerateIdeas(...args),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CLIENT_ID = 'client-uuid-abc'

const MOCK_CREDS = {
  developerToken: 'dev',
  clientId:       'cid',
  clientSecret:   'cs',
  refreshToken:   'rt',
  customerId:     '1234567890',
}

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/clients/x/google-ads/keyword-ideas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/clients/[id]/google-ads/keyword-ideas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAccess.mockResolvedValue({ ok: true })
    mockLoadCreds.mockResolvedValue(MOCK_CREDS)
    mockGenerateIdeas.mockResolvedValue([
      { text: 'china tour', avg_monthly_searches: 1000, competition: 'HIGH',
        competition_index: 85, low_top_of_page_bid: 1.5, high_top_of_page_bid: 4.5, average_cpc: 2.5 },
    ])
  })

  it('happy path: valid body → 200 with ideas + params passed through to library', async () => {
    const res = await POST(
      makeReq({ keywords: ['china tour', 'china travel'], geoTargetIds: [2554, 2036], languageId: 1000, network: 'GOOGLE_SEARCH' }),
      { params: { id: CLIENT_ID } },
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ideas.length).toBe(1)
    expect(json.ideas[0].text).toBe('china tour')

    expect(mockGenerateIdeas).toHaveBeenCalledWith(MOCK_CREDS, {
      keywords:     ['china tour', 'china travel'],
      geoTargetIds: [2554, 2036],
      languageId:   1000,
      network:      'GOOGLE_SEARCH',
    })
  })

  it('trims whitespace and drops empty seeds before calling the library', async () => {
    await POST(
      makeReq({ keywords: ['  china tour  ', '', '   '] }),
      { params: { id: CLIENT_ID } },
    )
    const passed = mockGenerateIdeas.mock.calls[0][1]
    expect(passed.keywords).toEqual(['china tour'])
  })

  it('rejects unauthenticated requests with 401/403/whatever auth returned', async () => {
    mockRequireAccess.mockResolvedValueOnce({ ok: false, status: 401, error: 'no session' })
    const res = await POST(
      makeReq({ keywords: ['china tour'] }),
      { params: { id: CLIENT_ID } },
    )
    expect(res.status).toBe(401)
    expect(mockGenerateIdeas).not.toHaveBeenCalled()
  })

  it('returns 400 when keywords is missing / empty / all-blank', async () => {
    for (const bad of [{}, { keywords: [] }, { keywords: ['', '  '] }]) {
      const res = await POST(makeReq(bad), { params: { id: CLIENT_ID } })
      expect(res.status).toBe(400)
    }
    expect(mockGenerateIdeas).not.toHaveBeenCalled()
  })

  it('returns 400 when geoTargetIds / languageId / network have wrong types', async () => {
    for (const bad of [
      { keywords: ['x'], geoTargetIds: 'nz' },
      { keywords: ['x'], geoTargetIds: [-1] },
      { keywords: ['x'], languageId: 'english' },
      { keywords: ['x'], network: 'YOUTUBE' },
    ]) {
      const res = await POST(makeReq(bad), { params: { id: CLIENT_ID } })
      expect(res.status).toBe(400)
    }
    expect(mockGenerateIdeas).not.toHaveBeenCalled()
  })

  it('returns 424 (not 500) when client has no Google Ads creds — operator signal is "onboarding, not outage"', async () => {
    mockLoadCreds.mockResolvedValueOnce(null)
    const res = await POST(
      makeReq({ keywords: ['china tour'] }),
      { params: { id: CLIENT_ID } },
    )
    expect(res.status).toBe(424)
  })

  it('returns 502 when the Keyword Planner call throws (upstream API failure signal)', async () => {
    mockGenerateIdeas.mockRejectedValueOnce(new Error('quota exceeded'))
    const res = await POST(
      makeReq({ keywords: ['china tour'] }),
      { params: { id: CLIENT_ID } },
    )
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.error).toContain('quota exceeded')
  })
})
