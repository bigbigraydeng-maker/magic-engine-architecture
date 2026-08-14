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

import { fetchGa4Snapshot } from '../client'
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
