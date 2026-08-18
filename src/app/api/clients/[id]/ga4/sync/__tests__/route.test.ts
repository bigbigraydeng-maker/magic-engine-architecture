import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Phase D (#1052): covers the "立即同步" gate — status='connected'+property_id
// required — and the snapshot-success vs API-failure distinction that feeds
// the settings UI's error surfacing.

const mocks = vi.hoisted(() => ({
  requireOnboardingClientAccess: vi.fn(),
  from:              vi.fn(),
  fetchGa4Snapshot:  vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireOnboardingClientAccess: mocks.requireOnboardingClientAccess,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

vi.mock('@/lib/ga4/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ga4/client')>()
  return { ...actual, fetchGa4Snapshot: mocks.fetchGa4Snapshot }
})

import { POST } from '../route'
import { Ga4ApiError } from '@/lib/ga4/client'

const CLIENT_ID = 'client-abc'

function routeContext() {
  return { params: { id: CLIENT_ID } }
}

function adminAccess() {
  return { ok: true as const, user: { email: 'admin@test.com' }, role: 'admin' as const, allowedClientId: null }
}

function makeRequest(body: unknown = {}) {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/ga4/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function connectorRow(row: { status: string; config: Record<string, unknown> | null } | null) {
  const chain: Record<string, unknown> = {}
  ;['select', 'eq'].forEach((m) => { chain[m] = vi.fn().mockReturnValue(chain) })
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null })
  return chain
}

function snapshotUpsert(id = 'snap-1') {
  return {
    upsert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id }, error: null }),
      }),
    }),
  }
}

function mockTables(connector: { status: string; config: Record<string, unknown> | null } | null) {
  mocks.from.mockImplementation((table: string) => {
    if (table === 'client_connectors') return connectorRow(connector)
    if (table === 'ga4_traffic_snapshots') return snapshotUpsert()
    throw new Error(`unexpected table: ${table}`)
  })
}

function fakeSnapshot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    property_id: '550203806',
    period_start: '2026-07-21',
    period_end: '2026-08-18',
    total_sessions: 0,
    total_users: 0,
    total_new_users: 0,
    total_pageviews: 0,
    avg_session_duration: 0,
    bounce_rate: 0,
    top_pages: [],
    top_sources: [],
    synced_at: '2026-08-18T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireOnboardingClientAccess.mockResolvedValue(adminAccess())
})

describe('POST /api/clients/[id]/ga4/sync', () => {
  it('returns 422 when the client has no ga4 connector row at all (OAuth/GSC connected but GA4 connector missing)', async () => {
    mockTables(null)

    const res = await POST(makeRequest(), routeContext())

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toMatch(/not connected/i)
    expect(mocks.fetchGa4Snapshot).not.toHaveBeenCalled()
  })

  it('returns 422 when the connector exists but is not status=connected (e.g. status=error from a failed verification)', async () => {
    mockTables({ status: 'error', config: { property_id: '550203806', error_reason: 'permission_denied' } })

    const res = await POST(makeRequest(), routeContext())

    expect(res.status).toBe(422)
    expect(mocks.fetchGa4Snapshot).not.toHaveBeenCalled()
  })

  it('returns 422 when connected but config.property_id is missing', async () => {
    mockTables({ status: 'connected', config: {} })

    const res = await POST(makeRequest(), routeContext())

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toMatch(/property_id/i)
    expect(mocks.fetchGa4Snapshot).not.toHaveBeenCalled()
  })

  it('succeeds and stores a snapshot when the property has real traffic', async () => {
    mockTables({ status: 'connected', config: { property_id: '550203806' } })
    mocks.fetchGa4Snapshot.mockResolvedValue(fakeSnapshot({ total_sessions: 120, total_users: 80 }))

    const res = await POST(makeRequest(), routeContext())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.total_sessions).toBe(120)
  })

  it('succeeds (not an error) when the property is valid but genuinely has zero traffic yet', async () => {
    mockTables({ status: 'connected', config: { property_id: '550203806' } })
    mocks.fetchGa4Snapshot.mockResolvedValue(fakeSnapshot())

    const res = await POST(makeRequest(), routeContext())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.total_sessions).toBe(0)
  })

  it('returns 401 with the Google status code when the token is unauthenticated', async () => {
    mockTables({ status: 'connected', config: { property_id: '550203806' } })
    mocks.fetchGa4Snapshot.mockRejectedValue(
      new Ga4ApiError(401, 'UNAUTHENTICATED', 'authError', 'Request had invalid authentication credentials.'),
    )

    const res = await POST(makeRequest(), routeContext())

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.code).toBe('UNAUTHENTICATED')
  })

  it('returns 400 when the property has no permission (Google rejects with PERMISSION_DENIED)', async () => {
    mockTables({ status: 'connected', config: { property_id: '550203806' } })
    mocks.fetchGa4Snapshot.mockRejectedValue(
      new Ga4ApiError(403, 'PERMISSION_DENIED', 'forbidden', 'The caller does not have permission.'),
    )

    const res = await POST(makeRequest(), routeContext())

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('PERMISSION_DENIED')
  })

  it('returns 502 when fetchGa4Snapshot resolves null (token/property combination failed silently)', async () => {
    mockTables({ status: 'connected', config: { property_id: '550203806' } })
    mocks.fetchGa4Snapshot.mockResolvedValue(null)

    const res = await POST(makeRequest(), routeContext())

    expect(res.status).toBe(502)
  })
})
