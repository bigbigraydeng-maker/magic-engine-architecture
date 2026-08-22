import { beforeEach, describe, expect, it, vi } from 'vitest'

// PR3a: ga4/client.ts's token resolution was migrated to the same
// new-table-first, legacy-fallback pattern gsc/client.ts's resolveAccessToken
// already uses (docs/specs/2026-08-11-onboarding-integrations-unify-v1.md §2.2).
// This test covers that resolution order specifically — not the GA4 report
// shaping logic, which is unchanged by PR3a.

const mocks = vi.hoisted(() => ({
  getValidTokenForConnection: vi.fn(),
  getValidAccessToken:  vi.fn(),
  dedicatedRows:        [] as Array<{ id: string; account_id: string; status: string }>,
  existenceError:       null as { message: string } | null,
}))

vi.mock('@/lib/platform-oauth/token-manager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platform-oauth/token-manager')>()
  return { ...actual, getValidTokenForConnection: mocks.getValidTokenForConnection }
})

vi.mock('@/lib/google-oauth/client', () => ({
  getValidAccessToken: mocks.getValidAccessToken,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => Promise.resolve({
              data: mocks.dedicatedRows,
              error: mocks.existenceError,
            })),
          })),
        })),
      })),
    })),
  },
}))

import { fetchGa4Snapshot, verifyGa4PropertyAccess } from '../client'

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
  mocks.dedicatedRows = [{ id: 'canonical-row', account_id: CLIENT_ID, status: 'active' }]
  mocks.existenceError = null
})

describe('fetchGa4Snapshot — token resolution priority', () => {
  it('uses the new platform_oauth_connections token when available, never touches the legacy path', async () => {
    mocks.getValidTokenForConnection.mockResolvedValue('new-table-token')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(emptyReport()))

    await fetchGa4Snapshot(PROPERTY, CLIENT_ID)

    expect(mocks.getValidTokenForConnection).toHaveBeenCalledWith('canonical-row', undefined)
    expect(mocks.getValidAccessToken).not.toHaveBeenCalled()
    const [, init] = fetchSpy.mock.calls[0]
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer new-table-token')
  })

  it('falls back to the legacy google_oauth_tokens path when the client has no new-table row yet', async () => {
    mocks.dedicatedRows = []
    mocks.getValidAccessToken.mockResolvedValue('legacy-token')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(emptyReport()))

    await fetchGa4Snapshot(PROPERTY, CLIENT_ID)

    expect(mocks.getValidAccessToken).toHaveBeenCalledWith(CLIENT_ID, undefined)
    const [, init] = fetchSpy.mock.calls[0]
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer legacy-token')
  })

  it('returns null (not a thrown error) when neither the new nor the legacy path has a token', async () => {
    mocks.dedicatedRows = []
    mocks.getValidAccessToken.mockResolvedValue(null)

    const result = await fetchGa4Snapshot(PROPERTY, CLIENT_ID)

    expect(result).toBeNull()
  })

  it('fails closed on a genuine new-path error instead of hiding it with the legacy token', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.getValidTokenForConnection.mockRejectedValue(new Error('transient db error'))
    mocks.getValidAccessToken.mockResolvedValue('legacy-token')
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(emptyReport()))

    const result = await fetchGa4Snapshot(PROPERTY, CLIENT_ID)

    expect(result).toBeNull()
    expect(mocks.getValidAccessToken).not.toHaveBeenCalled()
    expect(consoleWarn).toHaveBeenCalledWith(
      '[ga4/client] dedicated token resolution failed:', 'transient db error',
    )
  })

  it('does not use the legacy token when a dedicated GA4 row exists but is not active', async () => {
    mocks.dedicatedRows = [{ id: 'revoked-or-error-row', account_id: CLIENT_ID, status: 'error' }]
    mocks.getValidAccessToken.mockResolvedValue('legacy-token')

    const result = await fetchGa4Snapshot(PROPERTY, CLIENT_ID)

    expect(result).toBeNull()
    expect(mocks.getValidAccessToken).not.toHaveBeenCalled()
  })

  it('fails closed when checking whether a dedicated GA4 row exists fails', async () => {
    mocks.existenceError = { message: 'database unavailable' }
    mocks.getValidAccessToken.mockResolvedValue('legacy-token')
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await fetchGa4Snapshot(PROPERTY, CLIENT_ID)

    expect(result).toBeNull()
    expect(mocks.getValidAccessToken).not.toHaveBeenCalled()
  })

  it('prefers the canonical stable slot when a historical active row remains after cleanup failure', async () => {
    mocks.dedicatedRows = [
      { id: 'newer-historical-row', account_id: 'owner@example.com', status: 'active' },
      { id: 'canonical-row', account_id: CLIENT_ID, status: 'active' },
    ]
    mocks.getValidTokenForConnection.mockResolvedValue('canonical-token')
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(emptyReport()))

    await fetchGa4Snapshot(PROPERTY, CLIENT_ID)

    expect(mocks.getValidTokenForConnection).toHaveBeenCalledWith('canonical-row', undefined)
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
    mocks.dedicatedRows = []
    mocks.getValidAccessToken.mockResolvedValue('gsc-shared-token')
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(emptyReport()))

    const result = await verifyGa4PropertyAccess(CLIENT_ID, '550203806')

    expect(result).toEqual({ ok: true })
  })

  it('accepts a bare numeric property id and builds the properties/… resource name for the API call', async () => {
    mocks.getValidTokenForConnection.mockResolvedValue('token')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(emptyReport()))

    await verifyGa4PropertyAccess(CLIENT_ID, '550203806')

    const [url] = fetchSpy.mock.calls[0]
    expect(String(url)).toContain('properties/550203806:runReport')
  })

  it('returns reason:no_token when neither the GA4 nor the legacy/GSC-shared token resolves', async () => {
    mocks.dedicatedRows = []
    mocks.getValidAccessToken.mockResolvedValue(null)

    const result = await verifyGa4PropertyAccess(CLIENT_ID, '550203806')

    expect(result).toEqual({ ok: false, reason: 'no_token', detail: expect.any(String) })
  })

  it('returns reason:permission_denied on a 403 from the GA4 Data API', async () => {
    mocks.getValidTokenForConnection.mockResolvedValue('token')
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(errorResponse(403, 'PERMISSION_DENIED', 'User does not have sufficient permissions')),
    )

    const result = await verifyGa4PropertyAccess(CLIENT_ID, '550203806')

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reason: 'permission_denied' })
  })

  it('returns reason:not_found on a 400 from the GA4 Data API (property does not exist)', async () => {
    mocks.getValidTokenForConnection.mockResolvedValue('token')
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(errorResponse(400, 'INVALID_ARGUMENT', 'Invalid property 550203806')),
    )

    const result = await verifyGa4PropertyAccess(CLIENT_ID, '550203806')

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reason: 'not_found' })
  })

  it('returns reason:api_error on an unexpected 5xx / network failure', async () => {
    mocks.getValidTokenForConnection.mockResolvedValue('token')
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
    mocks.dedicatedRows = []
    mocks.getValidAccessToken.mockRejectedValue(new Error('supabase network failure'))

    const result = await verifyGa4PropertyAccess(CLIENT_ID, '550203806')

    expect(result).toEqual({ ok: false, reason: 'api_error', detail: 'supabase network failure' })
  })
})
