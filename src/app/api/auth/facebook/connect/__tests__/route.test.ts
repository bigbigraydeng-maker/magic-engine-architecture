/**
 * Anyone who can reach this URL could otherwise start a consent flow that
 * attaches their Meta account to a client they have no business touching. The
 * tenant guard is the whole point, so these tests care most about rejection —
 * plus one check that the #1152 publishing intent actually reaches the state.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireDashboardClientAccess: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireDashboardClientAccess,
}))

import { GET } from '../route'
import { verifyState } from '@/lib/meta-oauth/client'

const CLIENT_ID = '11111111-1111-1111-1111-111111111111'

function makeRequest(params: { clientId?: string; intent?: string }) {
  const url = new URL('http://localhost:3001/api/auth/facebook/connect')
  if (params.clientId) url.searchParams.set('client_id', params.clientId)
  if (params.intent)   url.searchParams.set('intent', params.intent)
  return new NextRequest(url)
}

function adminAccess() {
  return { ok: true as const, user: { email: 'admin@test.com' }, role: 'admin' as const, tier: 'admin' as const, allowedClientId: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FACEBOOK_APP_ID = 'app-id-123'
  process.env.FACEBOOK_APP_SECRET = 'app-secret-456'
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.magic-engine.com'
  mocks.requireDashboardClientAccess.mockResolvedValue(adminAccess())
})

describe('tenant isolation — no unauthenticated / cross-tenant reauthorisation', () => {
  it('rejects when the caller has no access to this client, without redirecting to Meta', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })

    const res = await GET(makeRequest({ clientId: CLIENT_ID, intent: 'publishing' }))

    expect(res.status).toBe(403)
    expect(res.headers.get('location')).toBeNull() // never issued a redirect to Meta
  })

  it('rejects an unauthenticated caller', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthenticated' })

    const res = await GET(makeRequest({ clientId: CLIENT_ID }))

    expect(res.status).toBe(401)
    expect(res.headers.get('location')).toBeNull()
  })

  it('gates the reauthorisation on the exact client id from the URL', async () => {
    await GET(makeRequest({ clientId: CLIENT_ID, intent: 'publishing' }))
    expect(mocks.requireDashboardClientAccess).toHaveBeenCalledWith(CLIENT_ID)
  })

  it('returns 400 when client_id is missing', async () => {
    const res = await GET(makeRequest({ intent: 'publishing' }))
    expect(res.status).toBe(400)
  })
})

describe('publishing intent reaches the signed state and requests the publishing scope', () => {
  it('intent=publishing round-trips into the state and the consent URL still asks for pages_manage_posts', async () => {
    const res = await GET(makeRequest({ clientId: CLIENT_ID, intent: 'publishing' }))

    expect(res.status).toBe(307)
    const authUrl = new URL(res.headers.get('location') ?? '')
    expect(authUrl.hostname).toContain('facebook.com')
    expect(authUrl.searchParams.get('scope')).toContain('pages_manage_posts')

    const state = authUrl.searchParams.get('state') ?? ''
    expect(verifyState(state)).toEqual({ clientId: CLIENT_ID, intent: 'publishing' })
  })

  it('a plain connect (no intent) carries no intent in its state — inbox flow unchanged', async () => {
    const res = await GET(makeRequest({ clientId: CLIENT_ID }))

    const authUrl = new URL(res.headers.get('location') ?? '')
    const state = authUrl.searchParams.get('state') ?? ''
    expect(verifyState(state)).toEqual({ clientId: CLIENT_ID })
  })

  it('ignores an unrecognised intent value rather than trusting it', async () => {
    const res = await GET(makeRequest({ clientId: CLIENT_ID, intent: 'delete_everything' }))

    const authUrl = new URL(res.headers.get('location') ?? '')
    const state = authUrl.searchParams.get('state') ?? ''
    expect(verifyState(state)).toEqual({ clientId: CLIENT_ID })
  })
})
