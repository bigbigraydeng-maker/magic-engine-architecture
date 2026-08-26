import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Cookie store the mocked next/headers hands the route.
const cookieState: { store: Map<string, string> } = { store: new Map() }

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  getUser: vi.fn(),
  resolveRedirectForSession: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => {
      const v = cookieState.store.get(name)
      return v ? { name, value: v } : undefined
    },
    getAll: () => Array.from(cookieState.store, ([name, value]) => ({ name, value })),
  }),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      verifyOtp: mocks.verifyOtp,
      getUser: mocks.getUser,
    },
  }),
}))

// The prior fail-closed regressions live in resolve-redirect.test.ts; here we
// only care that the CSRF gates run BEFORE we even reach this call, so mock
// it to a benign success unless a test overrides it.
vi.mock('@/lib/auth/resolve-redirect', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/resolve-redirect')>(
    '@/lib/auth/resolve-redirect',
  )
  return {
    ...actual,
    resolveRedirectForSession: mocks.resolveRedirectForSession,
  }
})

import { GET, POST } from '../route'

const CANONICAL_ORIGIN = 'https://app.magicengine.com.au'
// Realistic UUID shapes — matches the CLIENT_ID_RE in the route. Using the
// old `'client-b'` short-string fixtures would (correctly) now be rejected.
const CLIENT_B = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
const CLIENT_REVOKED = 'dddddddd-dddd-4ddd-dddd-dddddddddddd'

function getReq(query: Record<string, string>): NextRequest {
  const url = new URL(`${CANONICAL_ORIGIN}/auth/invite-landing`)
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url.toString(), { method: 'GET' })
}

function postReq(opts: {
  fields?: Record<string, string>
  originHeader?: string | null
}): NextRequest {
  const body = new URLSearchParams()
  Object.entries(opts.fields ?? {}).forEach(([k, v]) => body.set(k, v))
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
  }
  if (opts.originHeader !== null && opts.originHeader !== undefined) {
    headers['origin'] = opts.originHeader
  } else if (opts.originHeader === undefined) {
    headers['origin'] = CANONICAL_ORIGIN
  }
  // originHeader === null → intentionally omit
  return new NextRequest(`${CANONICAL_ORIGIN}/auth/invite-landing`, {
    method: 'POST',
    headers,
    body: body.toString(),
  })
}

function readSetCookieNonce(res: Response): { value?: string; raw?: string } {
  const raw = res.headers.get('set-cookie') ?? ''
  const match = /me-invite-nonce=([^;]*)/.exec(raw)
  return { value: match?.[1], raw }
}

describe('/auth/invite-landing CSRF gates', () => {
  beforeEach(() => {
    process.env.APP_URL = CANONICAL_ORIGIN
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    cookieState.store = new Map()
    mocks.verifyOtp.mockReset()
    mocks.verifyOtp.mockResolvedValue({ data: {}, error: null })
    mocks.getUser.mockReset()
    // Default: verifyOtp attaches a readable identity. Individual tests
    // override this to prove the fail-closed guard runs before landing.
    mocks.getUser.mockResolvedValue({ data: { user: { email: 'staff@cts.co.nz' } } })
    mocks.resolveRedirectForSession.mockReset()
    mocks.resolveRedirectForSession.mockResolvedValue(`/dashboard/clients/${CLIENT_B}`)
  })

  // ── GET: mint nonce; do NOT verifyOtp ─────────────────────────────────

  it('GET renders the confirm page with a hidden nonce field AND sets the nonce cookie, WITHOUT verifying the OTP', async () => {
    const res = await GET(getReq({ token_hash: 'th', type: 'invite', client_id: CLIENT_B }))
    expect(res.status).toBe(200)
    const html = await res.text()
    const setCookie = readSetCookieNonce(res)
    expect(setCookie.value).toBeTruthy()
    expect(setCookie.raw).toMatch(/HttpOnly/i)
    expect(setCookie.raw).toMatch(/SameSite=strict/i)
    expect(setCookie.raw).toMatch(/Path=\/auth\/invite-landing/i)
    // Same nonce in the form field so the POST can round-trip it.
    expect(html).toContain(`name="nonce" value="${setCookie.value}"`)
    // GET must NEVER consume the invite token (email scanner prefetches).
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })

  it('GET rejects a malformed query without minting a nonce', async () => {
    const res = await GET(getReq({ token_hash: '', type: 'invite' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('error=invite_invalid')
    expect(readSetCookieNonce(res).value).toBeUndefined()
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })

  // ── POST CSRF gates ──────────────────────────────────────────────────

  // ── CONTRACT (hotfix 2026-08-27): verifyOtp type must be the unified 'email' ──

  it('CONTRACT: passes type "email" to verifyOtp regardless of the URL type (both invite- and magiclink-issued tokens redeem)', async () => {
    // Production canary at 03:27:09 NZST 2026-08-27 failed here: the
    // email link carried `type=magiclink`, POST reached verifyOtp with
    // `type: 'magiclink'`, and Supabase GoTrue rejected it with
    //   "Email link is invalid or has expired"
    // The shipped, working /api/auth/verify-otp path uses the unified
    // `type: 'email'` for exactly this reason (its inline comment
    // documents that 'email' matches both signup- and magiclink-issued
    // tokens). This regression locks that same contract for the
    // one-click invite landing.
    cookieState.store.set('me-invite-nonce', 'nonce-abc')

    await POST(postReq({
      fields: { token_hash: 'H_MAGIC', type: 'magiclink', client_id: CLIENT_B, nonce: 'nonce-abc' },
    }))
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: 'H_MAGIC',
      type: 'email',
    })

    mocks.verifyOtp.mockClear()
    cookieState.store.set('me-invite-nonce', 'nonce-abc')

    await POST(postReq({
      fields: { token_hash: 'H_INVITE', type: 'invite', client_id: CLIENT_B, nonce: 'nonce-abc' },
    }))
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: 'H_INVITE',
      type: 'email',
    })
  })

  it('POST accepts a valid same-origin + matching nonce and lands the invitee', async () => {
    cookieState.store.set('me-invite-nonce', 'nonce-abc')
    const res = await POST(postReq({
      fields: { token_hash: 'th', type: 'invite', client_id: CLIENT_B, nonce: 'nonce-abc' },
    }))
    expect(mocks.verifyOtp).toHaveBeenCalledOnce()
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`${CANONICAL_ORIGIN}/dashboard/clients/${CLIENT_B}`)
    // The nonce is burned on success too — one confirmation click, one session.
    expect(res.headers.get('set-cookie') ?? '').toMatch(/me-invite-nonce=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i)
  })

  it('POST rejects a cross-origin request BEFORE verifyOtp — attacker.com Origin header', async () => {
    cookieState.store.set('me-invite-nonce', 'nonce-abc')
    const res = await POST(postReq({
      fields: { token_hash: 'th', type: 'invite', client_id: CLIENT_B, nonce: 'nonce-abc' },
      originHeader: 'https://attacker.example',
    }))
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('error=invite_invalid')
    // Nonce cookie burned so a follow-up replay can't succeed either.
    expect(res.headers.get('set-cookie') ?? '').toMatch(/me-invite-nonce=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i)
  })

  it('POST rejects when the Origin header is missing entirely (unsafe / stripped)', async () => {
    cookieState.store.set('me-invite-nonce', 'nonce-abc')
    const res = await POST(postReq({
      fields: { token_hash: 'th', type: 'invite', client_id: CLIENT_B, nonce: 'nonce-abc' },
      originHeader: null,
    }))
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('error=invite_invalid')
  })

  it('POST rejects when the nonce cookie is missing (fresh browser, no GET first)', async () => {
    // cookieState.store deliberately empty.
    const res = await POST(postReq({
      fields: { token_hash: 'th', type: 'invite', client_id: CLIENT_B, nonce: 'nonce-abc' },
    }))
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('error=invite_invalid')
  })

  it('POST rejects when the form nonce does not match the cookie nonce (constant-time mismatch)', async () => {
    cookieState.store.set('me-invite-nonce', 'nonce-abc')
    const res = await POST(postReq({
      fields: { token_hash: 'th', type: 'invite', client_id: CLIENT_B, nonce: 'guessed-wrong' },
    }))
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('error=invite_invalid')
  })

  it('POST rejects a replayed nonce — a second submission after the cookie is burned finds no cookie and fails', async () => {
    cookieState.store.set('me-invite-nonce', 'nonce-abc')
    // First submission succeeds and burns the cookie.
    const first = await POST(postReq({
      fields: { token_hash: 'th', type: 'invite', client_id: CLIENT_B, nonce: 'nonce-abc' },
    }))
    expect(first.status).toBe(303)
    expect(mocks.verifyOtp).toHaveBeenCalledOnce()
    // Simulate the browser having lost the cookie because the server deleted it.
    cookieState.store.delete('me-invite-nonce')
    // Replay: same form nonce, no cookie now.
    const replay = await POST(postReq({
      fields: { token_hash: 'th', type: 'invite', client_id: CLIENT_B, nonce: 'nonce-abc' },
    }))
    expect(replay.status).toBe(303)
    expect(replay.headers.get('location')).toContain('error=invite_invalid')
    // verifyOtp count did NOT go up.
    expect(mocks.verifyOtp).toHaveBeenCalledOnce()
  })

  // ── Preserve prior contracts ────────────────────────────────────────

  it('preserves wrong-customer fail-closed when CSRF passes but membership is missing', async () => {
    cookieState.store.set('me-invite-nonce', 'nonce-abc')
    const { INVITE_INVALID_REDIRECT } = await import('@/lib/auth/resolve-redirect')
    mocks.resolveRedirectForSession.mockResolvedValueOnce(INVITE_INVALID_REDIRECT)
    const res = await POST(postReq({
      fields: { token_hash: 'th', type: 'invite', client_id: CLIENT_REVOKED, nonce: 'nonce-abc' },
    }))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('error=invite_invalid')
    const setCookie = res.headers.get('set-cookie') ?? ''
    // Nonce burned...
    expect(setCookie).toMatch(/me-invite-nonce=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i)
    // ...and no session cookies applied (only the nonce delete may be present).
    expect(setCookie).not.toMatch(/sb-.*=/i)
  })

  it('POST rejects malformed body (missing token_hash) even when CSRF is satisfied', async () => {
    cookieState.store.set('me-invite-nonce', 'nonce-abc')
    const res = await POST(postReq({
      fields: { type: 'invite', client_id: CLIENT_B, nonce: 'nonce-abc' },
    }))
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('error=invite_invalid')
  })

  // ── Contract V2 §1: client_id shape ─────────────────────────────────

  it('GET fails closed on missing client_id (undefined) — no nonce, no verifyOtp', async () => {
    const res = await GET(getReq({ token_hash: 'th', type: 'invite' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('error=invite_invalid')
    // No nonce cookie must be minted on the reject path.
    expect(readSetCookieNonce(res).value).toBeUndefined()
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })

  it('GET fails closed on empty client_id', async () => {
    const res = await GET(getReq({ token_hash: 'th', type: 'invite', client_id: '' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('error=invite_invalid')
    expect(readSetCookieNonce(res).value).toBeUndefined()
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })

  it('GET fails closed on malformed client_id (not a UUID — e.g. truncated or injected)', async () => {
    const res = await GET(getReq({ token_hash: 'th', type: 'invite', client_id: 'not-a-uuid' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('error=invite_invalid')
    expect(readSetCookieNonce(res).value).toBeUndefined()
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })

  it('POST fails closed on missing client_id BEFORE verifyOtp, and burns the nonce', async () => {
    cookieState.store.set('me-invite-nonce', 'nonce-abc')
    const res = await POST(postReq({
      fields: { token_hash: 'th', type: 'invite', nonce: 'nonce-abc' },
    }))
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('error=invite_invalid')
    expect(res.headers.get('set-cookie') ?? '').toMatch(/me-invite-nonce=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i)
  })

  it('POST fails closed on empty client_id', async () => {
    cookieState.store.set('me-invite-nonce', 'nonce-abc')
    const res = await POST(postReq({
      fields: { token_hash: 'th', type: 'invite', client_id: '', nonce: 'nonce-abc' },
    }))
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('error=invite_invalid')
  })

  it('POST fails closed on malformed client_id (short string, not a UUID)', async () => {
    cookieState.store.set('me-invite-nonce', 'nonce-abc')
    const res = await POST(postReq({
      fields: { token_hash: 'th', type: 'invite', client_id: 'not-a-uuid', nonce: 'nonce-abc' },
    }))
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('error=invite_invalid')
  })

  // ── Contract V2 §2: verifyOtp succeeded but no session identity ─────

  it('POST fails closed when verifyOtp returns success but getUser gives NO user (fallback to /dashboard would leak)', async () => {
    cookieState.store.set('me-invite-nonce', 'nonce-abc')
    mocks.verifyOtp.mockResolvedValueOnce({ data: {}, error: null })
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } })
    const res = await POST(postReq({
      fields: { token_hash: 'th', type: 'invite', client_id: CLIENT_B, nonce: 'nonce-abc' },
    }))
    expect(mocks.verifyOtp).toHaveBeenCalledOnce()
    // Landing decision must NEVER run when identity is unreadable.
    expect(mocks.resolveRedirectForSession).not.toHaveBeenCalled()
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('error=invite_invalid')
    const setCookie = res.headers.get('set-cookie') ?? ''
    // Nonce burned, and no session cookies (sb-*) applied.
    expect(setCookie).toMatch(/me-invite-nonce=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i)
    expect(setCookie).not.toMatch(/sb-.*=/i)
  })

  it('POST fails closed when verifyOtp returns success but getUser gives a user WITHOUT email', async () => {
    cookieState.store.set('me-invite-nonce', 'nonce-abc')
    mocks.verifyOtp.mockResolvedValueOnce({ data: {}, error: null })
    mocks.getUser.mockResolvedValueOnce({ data: { user: { email: null } } })
    const res = await POST(postReq({
      fields: { token_hash: 'th', type: 'invite', client_id: CLIENT_B, nonce: 'nonce-abc' },
    }))
    expect(mocks.resolveRedirectForSession).not.toHaveBeenCalled()
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('error=invite_invalid')
  })
})
