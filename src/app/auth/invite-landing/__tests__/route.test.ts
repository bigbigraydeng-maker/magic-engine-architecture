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
    mocks.resolveRedirectForSession.mockReset()
    mocks.resolveRedirectForSession.mockResolvedValue('/dashboard/clients/client-b')
  })

  // ── GET: mint nonce; do NOT verifyOtp ─────────────────────────────────

  it('GET renders the confirm page with a hidden nonce field AND sets the nonce cookie, WITHOUT verifying the OTP', async () => {
    const res = await GET(getReq({ token_hash: 'th', type: 'invite', client_id: 'client-b' }))
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

  it('POST accepts a valid same-origin + matching nonce and lands the invitee', async () => {
    cookieState.store.set('me-invite-nonce', 'nonce-abc')
    const res = await POST(postReq({
      fields: { token_hash: 'th', type: 'invite', client_id: 'client-b', nonce: 'nonce-abc' },
    }))
    expect(mocks.verifyOtp).toHaveBeenCalledOnce()
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`${CANONICAL_ORIGIN}/dashboard/clients/client-b`)
    // The nonce is burned on success too — one confirmation click, one session.
    expect(res.headers.get('set-cookie') ?? '').toMatch(/me-invite-nonce=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i)
  })

  it('POST rejects a cross-origin request BEFORE verifyOtp — attacker.com Origin header', async () => {
    cookieState.store.set('me-invite-nonce', 'nonce-abc')
    const res = await POST(postReq({
      fields: { token_hash: 'th', type: 'invite', client_id: 'client-b', nonce: 'nonce-abc' },
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
      fields: { token_hash: 'th', type: 'invite', client_id: 'client-b', nonce: 'nonce-abc' },
      originHeader: null,
    }))
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('error=invite_invalid')
  })

  it('POST rejects when the nonce cookie is missing (fresh browser, no GET first)', async () => {
    // cookieState.store deliberately empty.
    const res = await POST(postReq({
      fields: { token_hash: 'th', type: 'invite', client_id: 'client-b', nonce: 'nonce-abc' },
    }))
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('error=invite_invalid')
  })

  it('POST rejects when the form nonce does not match the cookie nonce (constant-time mismatch)', async () => {
    cookieState.store.set('me-invite-nonce', 'nonce-abc')
    const res = await POST(postReq({
      fields: { token_hash: 'th', type: 'invite', client_id: 'client-b', nonce: 'guessed-wrong' },
    }))
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('error=invite_invalid')
  })

  it('POST rejects a replayed nonce — a second submission after the cookie is burned finds no cookie and fails', async () => {
    cookieState.store.set('me-invite-nonce', 'nonce-abc')
    // First submission succeeds and burns the cookie.
    const first = await POST(postReq({
      fields: { token_hash: 'th', type: 'invite', client_id: 'client-b', nonce: 'nonce-abc' },
    }))
    expect(first.status).toBe(303)
    expect(mocks.verifyOtp).toHaveBeenCalledOnce()
    // Simulate the browser having lost the cookie because the server deleted it.
    cookieState.store.delete('me-invite-nonce')
    // Replay: same form nonce, no cookie now.
    const replay = await POST(postReq({
      fields: { token_hash: 'th', type: 'invite', client_id: 'client-b', nonce: 'nonce-abc' },
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
      fields: { token_hash: 'th', type: 'invite', client_id: 'client-revoked', nonce: 'nonce-abc' },
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
      fields: { type: 'invite', client_id: 'client-b', nonce: 'nonce-abc' },
    }))
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('error=invite_invalid')
  })
})
