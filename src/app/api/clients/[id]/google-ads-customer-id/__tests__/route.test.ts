import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireDashboardClientAccess: vi.fn(),
  resolveCustomerId: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireDashboardClientAccess,
}))

vi.mock('@/lib/google-ads/creds-loader', () => ({
  resolveCustomerId: mocks.resolveCustomerId,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

import { GET, PATCH } from '../route'

const CLIENT_ID = 'client-abc'

function routeContext() {
  return { params: Promise.resolve({ id: CLIENT_ID }) }
}

function adminAccess() {
  return { ok: true as const, user: { email: 'admin@test.com' }, role: 'admin' as const, allowedClientId: null }
}

function makeGetRequest() {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/google-ads-customer-id`)
}

function makePatchRequest(body: unknown) {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/google-ads-customer-id`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireDashboardClientAccess.mockResolvedValue(adminAccess())
})

describe('GET /api/clients/[id]/google-ads-customer-id', () => {
  it('returns 401 when not authenticated', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthenticated' })
    const res = await GET(makeGetRequest(), routeContext())
    expect(res.status).toBe(401)
  })

  it('delegates to resolveCustomerId and returns its result verbatim (value + source)', async () => {
    mocks.resolveCustomerId.mockResolvedValue({ customer_id: '1234567890', source: 'clients_table' })
    const res = await GET(makeGetRequest(), routeContext())
    const body = await res.json()
    expect(body).toEqual({ customer_id: '1234567890', source: 'clients_table' })
    expect(mocks.resolveCustomerId).toHaveBeenCalledWith(expect.anything(), CLIENT_ID)
  })
})

describe('PATCH /api/clients/[id]/google-ads-customer-id', () => {
  it('returns 401 when not authenticated', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthenticated' })
    const res = await PATCH(makePatchRequest({ customer_id: '1234567890' }), routeContext())
    expect(res.status).toBe(401)
  })

  it('rejects a customer_id that is not 10 digits', async () => {
    const res = await PATCH(makePatchRequest({ customer_id: '12345' }), routeContext())
    expect(res.status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('strips dashes/spaces before validating (accepts 123-456-7890 form)', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    mocks.from.mockReturnValue({ update: vi.fn().mockReturnValue({ eq }) })

    const res = await PATCH(makePatchRequest({ customer_id: '123-456-7890' }), routeContext())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true, customer_id: '1234567890' })
  })

  it('clears the binding when customer_id is empty/null', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({ eq })
    mocks.from.mockReturnValue({ update })

    const res = await PATCH(makePatchRequest({ customer_id: null }), routeContext())

    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledWith({ google_ads_customer_id: null })
  })

  it('writes the normalised value to clients.google_ads_customer_id', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({ eq })
    mocks.from.mockReturnValue({ update })

    await PATCH(makePatchRequest({ customer_id: '1234567890' }), routeContext())

    expect(mocks.from).toHaveBeenCalledWith('clients')
    expect(update).toHaveBeenCalledWith({ google_ads_customer_id: '1234567890' })
    expect(eq).toHaveBeenCalledWith('id', CLIENT_ID)
  })

  it('returns 500 with a clear message when the DB write fails', async () => {
    const eq = vi.fn().mockResolvedValue({ error: { message: 'db timeout' } })
    mocks.from.mockReturnValue({ update: vi.fn().mockReturnValue({ eq }) })

    const res = await PATCH(makePatchRequest({ customer_id: '1234567890' }), routeContext())

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain('db timeout')
  })
})
