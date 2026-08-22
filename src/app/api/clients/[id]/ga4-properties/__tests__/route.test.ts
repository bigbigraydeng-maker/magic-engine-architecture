import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireOnboardingClientAccess: vi.fn(),
  from:               vi.fn(),
  resolveAccessToken: vi.fn(),
  listGa4Properties:  vi.fn(),
  setGa4Property:     vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireOnboardingClientAccess: mocks.requireOnboardingClientAccess,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

vi.mock('@/lib/ga4/admin', () => ({
  listGa4Properties: mocks.listGa4Properties,
}))

vi.mock('@/lib/ga4/client', () => ({
  resolveAccessToken: mocks.resolveAccessToken,
}))

vi.mock('@/lib/ga4/property', () => ({
  setGa4Property: mocks.setGa4Property,
}))

import { GET, PATCH } from '../route'

const CLIENT_ID = 'client-abc'

function routeContext() {
  return { params: Promise.resolve({ id: CLIENT_ID }) }
}

function adminAccess() {
  return { ok: true as const, user: { email: 'admin@test.com' }, role: 'admin' as const, allowedClientId: null }
}

function connectorRow(
  config: Record<string, unknown> | null,
  status: 'connected' | 'error' = 'connected',
  error: { message: string } | null = null,
) {
  const chain: Record<string, unknown> = {}
  ;['select', 'eq'].forEach((m) => { chain[m] = vi.fn().mockReturnValue(chain) })
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: config === null ? null : { status, config }, error })
  return chain
}

function makeGetRequest() {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/ga4-properties`)
}

function makePatchRequest(body: unknown) {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/ga4-properties`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireOnboardingClientAccess.mockResolvedValue(adminAccess())
})

describe('GET /api/clients/[id]/ga4-properties', () => {
  it('returns 401 when not authenticated', async () => {
    mocks.requireOnboardingClientAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthenticated' })
    const res = await GET(makeGetRequest(), routeContext())
    expect(res.status).toBe(401)
  })

  it('returns connected:false when no Google token resolves for this client at all (GA4-specific or GSC-shared)', async () => {
    mocks.from.mockReturnValue(connectorRow(null))
    mocks.resolveAccessToken.mockResolvedValue(null)

    const res = await GET(makeGetRequest(), routeContext())
    const body = await res.json()

    expect(body).toEqual({ connected: false, connector_status: null, current: null, options: [] })
  })

  it('is connected via the GSC-shared fallback token even with no client_connectors.ga4 row yet (#1052 root cause)', async () => {
    mocks.from.mockReturnValue(connectorRow(null))
    mocks.resolveAccessToken.mockResolvedValue('gsc-shared-token')
    mocks.listGa4Properties.mockResolvedValue({ ok: true, properties: [] })

    const res = await GET(makeGetRequest(), routeContext())
    const body = await res.json()

    expect(body.connected).toBe(true)
    expect(body.connector_status).toBeNull()
    expect(body.current).toBeNull()
  })

  it('reads `current` from client_connectors (not platform_oauth_connections) and formats it as a resource name', async () => {
    mocks.from.mockReturnValue(connectorRow({ property_id: '550203806' }))
    mocks.resolveAccessToken.mockResolvedValue('token')
    mocks.listGa4Properties.mockResolvedValue({ ok: true, properties: [] })

    const res = await GET(makeGetRequest(), routeContext())
    const body = await res.json()

    expect(body.current).toBe('properties/550203806')
    expect(body.connector_status).toBe('connected')
  })

  it('returns 503 and stops when the connector state cannot be read', async () => {
    mocks.from.mockReturnValue(connectorRow(null, 'connected', { message: 'database unavailable' }))

    const res = await GET(makeGetRequest(), routeContext())

    expect(res.status).toBe(503)
    expect(mocks.resolveAccessToken).not.toHaveBeenCalled()
    expect(mocks.listGa4Properties).not.toHaveBeenCalled()
  })

  it('does not expose a malformed stored Property as the current selection', async () => {
    mocks.from.mockReturnValue(connectorRow({ property_id: 'not-a-property' }))
    mocks.resolveAccessToken.mockResolvedValue('token')
    mocks.listGa4Properties.mockResolvedValue({ ok: true, properties: [] })

    const body = await (await GET(makeGetRequest(), routeContext())).json()

    expect(body.current).toBeNull()
    expect(body.connector_status).toBe('connected')
  })

  it('returns google_unavailable when listGa4Properties itself fails (distinct from "zero properties")', async () => {
    mocks.from.mockReturnValue(connectorRow(null))
    mocks.resolveAccessToken.mockResolvedValue('token')
    mocks.listGa4Properties.mockResolvedValue({ ok: false, reason: 'api_failed' })

    const res = await GET(makeGetRequest(), routeContext())
    const body = await res.json()

    expect(body.error).toBe('google_unavailable')
  })

  it('returns the current selection + available options on success', async () => {
    mocks.from.mockReturnValue(connectorRow({ property_id: '1' }))
    mocks.resolveAccessToken.mockResolvedValue('token')
    mocks.listGa4Properties.mockResolvedValue({
      ok: true,
      properties: [
        { property: 'properties/1', displayName: 'Site A' },
        { property: 'properties/2', displayName: 'Site B' },
      ],
    })

    const res = await GET(makeGetRequest(), routeContext())
    const body = await res.json()

    expect(body).toEqual({
      connected: true,
      connector_status: 'connected',
      current: 'properties/1',
      options: [
        { property: 'properties/1', display_name: 'Site A' },
        { property: 'properties/2', display_name: 'Site B' },
      ],
    })
  })

  it('keeps OAuth availability separate from a failed Property verification', async () => {
    mocks.from.mockReturnValue(connectorRow(
      { property_id: '550203806', error_reason: 'permission_denied' },
      'error',
    ))
    mocks.resolveAccessToken.mockResolvedValue('token')
    mocks.listGa4Properties.mockResolvedValue({ ok: true, properties: [] })

    const body = await (await GET(makeGetRequest(), routeContext())).json()

    expect(body.connected).toBe(true)
    expect(body.connector_status).toBe('error')
    expect(body.current).toBe('properties/550203806')
  })
})

describe('PATCH /api/clients/[id]/ga4-properties', () => {
  it('returns 401 when not authenticated', async () => {
    mocks.requireOnboardingClientAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthenticated' })
    const res = await PATCH(makePatchRequest({ property: 'properties/1' }), routeContext())
    expect(res.status).toBe(401)
  })

  it('returns 400 when `property` is missing', async () => {
    const res = await PATCH(makePatchRequest({}), routeContext())
    expect(res.status).toBe(400)
  })

  it('returns 400 with a plain-language message when setGa4Property reports not_connected', async () => {
    mocks.setGa4Property.mockResolvedValue({ ok: false, reason: 'not_connected' })
    const res = await PATCH(makePatchRequest({ property: 'properties/1' }), routeContext())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.reason).toBe('not_connected')
  })

  it('returns 400 with a plain-language message when the property id is malformed', async () => {
    mocks.setGa4Property.mockResolvedValue({ ok: false, reason: 'invalid' })
    const res = await PATCH(makePatchRequest({ property: 'not-a-property' }), routeContext())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.reason).toBe('invalid')
  })

  it('returns 503 instead of claiming success when the verified state cannot be stored', async () => {
    mocks.setGa4Property.mockResolvedValue({ ok: false, reason: 'storage_error' })
    const res = await PATCH(makePatchRequest({ property: 'properties/1' }), routeContext())
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.reason).toBe('storage_error')
    expect(body.error).toMatch(/保存不了/)
  })

  it('returns success + status:connected on a verified bind', async () => {
    mocks.setGa4Property.mockResolvedValue({ ok: true, status: 'connected', propertyId: '550203806' })
    const res = await PATCH(makePatchRequest({ property: '550203806' }), routeContext())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true, property: 'properties/550203806', status: 'connected' })
  })

  it('returns success:true + status:error with a plain-language reason when verification fails (permission)', async () => {
    mocks.setGa4Property.mockResolvedValue({
      ok: true, status: 'error', propertyId: '550203806',
      reason: 'permission_denied', detail: 'no access',
    })
    const res = await PATCH(makePatchRequest({ property: '550203806' }), routeContext())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.status).toBe('error')
    expect(body.reason).toBe('permission_denied')
    expect(typeof body.message).toBe('string')
  })

  it('returns success:true + status:error with a plain-language reason when the property does not exist', async () => {
    mocks.setGa4Property.mockResolvedValue({
      ok: true, status: 'error', propertyId: '999999999',
      reason: 'not_found', detail: 'no such property',
    })
    const res = await PATCH(makePatchRequest({ property: '999999999' }), routeContext())
    const body = await res.json()
    expect(body.status).toBe('error')
    expect(body.reason).toBe('not_found')
  })
})
