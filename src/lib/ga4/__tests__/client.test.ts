import { beforeEach, describe, expect, it, vi } from 'vitest'

// PR3a: ga4/client.ts's token resolution was migrated to the same
// new-table-first, legacy-fallback pattern gsc/client.ts's resolveAccessToken
// already uses (docs/specs/2026-08-11-onboarding-integrations-unify-v1.md §2.2).
// This test covers that resolution order specifically — not the GA4 report
// shaping logic, which is unchanged by PR3a.

const mocks = vi.hoisted(() => ({
  getValidToken:        vi.fn(),
  getValidAccessToken:  vi.fn(),
}))

vi.mock('@/lib/platform-oauth/token-manager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platform-oauth/token-manager')>()
  return { ...actual, getValidToken: mocks.getValidToken }
})

vi.mock('@/lib/google-oauth/client', () => ({
  getValidAccessToken: mocks.getValidAccessToken,
}))

import { fetchGa4Snapshot, verifyGa4PropertyAccess } from '../client'
import { PlatformConnectionNotFoundError } from '@/lib/platform-oauth/token-manager'

const CLIENT_ID = 'client-1'
const PROPERTY  = 'properties/123456789'

// A fresh Response per call — runReport's 3 parallel calls (Promise.all) each
// read their own body once; sharing one Response instance across them throws
// "Body has already been read".
function emptyReport() {
  return new Response(JSON.stringify({ rows: [] }), { status: 200 })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fetchGa4Snapshot — token resolution priority', () => {
  it('uses the new platform_oauth_connections token when available, never touches the legacy path', async () => {
    mocks.getValidToken.mockResolvedValue('new-table-token')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(emptyReport()))

    await fetchGa4Snapshot(PROPERTY, CLIENT_ID)

    expect(mocks.getValidToken).toHaveBeenCalledWith(CLIENT_ID, 'google_ga4', undefined)
    expect(mocks.getValidAccessToken).not.toHaveBeenCalled()
    const [, init] = fetchSpy.mock.calls[0]
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer new-table-token')
  })

  it('falls back to the legacy google_oauth_tokens path when the client has no new-table row yet', async () => {
    mocks.getValidToken.mockRejectedValue(new PlatformConnectionNotFoundError(CLIENT_ID, 'google_ga4'))
    mocks.getValidAccessToken.mockResolvedValue('legacy-token')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(emptyReport()))

    await fetchGa4Snapshot(PROPERTY, CLIENT_ID)

    expect(mocks.getValidAccessToken).toHaveBeenCalledWith(CLIENT_ID, undefined)
    const [, init] = fetchSpy.mock.calls[0]
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer legacy-token')
  })

  it('returns null (not a thrown error) when neither the new nor the legacy path has a token', async () => {
    mocks.getValidToken.mockRejectedValue(new PlatformConnectionNotFoundError(CLIENT_ID, 'google_ga4'))
    mocks.getValidAccessToken.mockResolvedValue(null)

    const result = await fetchGa4Snapshot(PROPERTY, CLIENT_ID)

    expect(result).toBeNull()
  })

  it('a genuine (non-not-found) error from the new path is logged but still falls through to legacy', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.getValidToken.mockRejectedValue(new Error('transient db error'))
    mocks.getValidAccessToken.mockResolvedValue('legacy-token')
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(emptyReport()))

    const result = await fetchGa4Snapshot(PROPERTY, CLIENT_ID)

    expect(result).not.toBeNull()
    expect(consoleWarn).toHaveBeenCalledWith(
      '[ga4/client] getValidToken error:', 'transient db error',
    )
  })
})

// #1052 GA4 connector diagnosis (2026-08-18): setGa4Property calls this
// before ever marking a connector 'connected' — it must correctly tell apart
// "genuinely no access" from "no traffic yet" and from "no token at all".
describe('verifyGa4PropertyAccess', () => {
  function errorResponse(status: number, googleStatus: string, message: string) {
    return new Response(JSON.stringify({ error: { status: googleStatus, message } }), { status })
  }

  it('returns ok:true when the token has a working shared (GSC-fallback) grant, even with zero rows of traffic', async () => {
    mocks.getValidToken.mockRejectedValue(new PlatformConnectionNotFoundError(CLIENT_ID, 'google_ga4'))
    mocks.getValidAccessToken.mockResolvedValue('gsc-shared-token')
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(emptyReport()))

    const result = await verifyGa4PropertyAccess(CLIENT_ID, '550203806')

    expect(result).toEqual({ ok: true })
  })

  it('accepts a bare numeric property id and builds the properties/… resource name for the API call', async () => {
    mocks.getValidToken.mockResolvedValue('token')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(emptyReport()))

    await verifyGa4PropertyAccess(CLIENT_ID, '550203806')

    const [url] = fetchSpy.mock.calls[0]
    expect(String(url)).toContain('properties/550203806:runReport')
  })

  it('returns reason:no_token when neither the GA4 nor the legacy/GSC-shared token resolves', async () => {
    mocks.getValidToken.mockRejectedValue(new PlatformConnectionNotFoundError(CLIENT_ID, 'google_ga4'))
    mocks.getValidAccessToken.mockResolvedValue(null)

    const result = await verifyGa4PropertyAccess(CLIENT_ID, '550203806')

    expect(result).toEqual({ ok: false, reason: 'no_token', detail: expect.any(String) })
  })

  it('returns reason:permission_denied on a 403 from the GA4 Data API', async () => {
    mocks.getValidToken.mockResolvedValue('token')
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(errorResponse(403, 'PERMISSION_DENIED', 'User does not have sufficient permissions')),
    )

    const result = await verifyGa4PropertyAccess(CLIENT_ID, '550203806')

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reason: 'permission_denied' })
  })

  it('returns reason:not_found on a 400 from the GA4 Data API (property does not exist)', async () => {
    mocks.getValidToken.mockResolvedValue('token')
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(errorResponse(400, 'INVALID_ARGUMENT', 'Invalid property 550203806')),
    )

    const result = await verifyGa4PropertyAccess(CLIENT_ID, '550203806')

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reason: 'not_found' })
  })

  it('returns reason:api_error on an unexpected 5xx / network failure', async () => {
    mocks.getValidToken.mockResolvedValue('token')
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(errorResponse(500, 'INTERNAL', 'backend hiccup')),
    )

    const result = await verifyGa4PropertyAccess(CLIENT_ID, '550203806')

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reason: 'api_error' })
  })

  // 魏征 2026-08-18 复审: resolveAccessToken()'s legacy fallback
  // (getValidAccessToken) isn't wrapped in try/catch at its own call site —
  // a genuine exception (e.g. a Supabase network failure while looking up
  // the token row) must not propagate out of verifyGa4PropertyAccess and
  // become an unhandled 500 in the PATCH route; it must degrade to the same
  // structured api_error result every other failure path produces.
  it('degrades to reason:api_error instead of throwing when resolveAccessToken itself throws', async () => {
    mocks.getValidToken.mockRejectedValue(new PlatformConnectionNotFoundError(CLIENT_ID, 'google_ga4'))
    mocks.getValidAccessToken.mockRejectedValue(new Error('supabase network failure'))

    const result = await verifyGa4PropertyAccess(CLIENT_ID, '550203806')

    expect(result).toEqual({ ok: false, reason: 'api_error', detail: 'supabase network failure' })
  })
})
