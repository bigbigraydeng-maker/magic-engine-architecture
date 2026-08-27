/**
 * GET  /auth/invite-landing?token_hash=<h>&type=<GoTrue verification_type>&client_id=<id>
 * POST /auth/invite-landing  (form body: token_hash, type, client_id)
 *
 * Landing endpoint for the "you've been invited" email. The invitee's first
 * click lands here. GET renders a confirmation page WITHOUT consuming the
 * one-time token — mail security scanners, link-preview bots and email
 * clients routinely prefetch GET URLs, which would burn the token (and hand
 * the resulting session cookie to the scanner) before the real invitee ever
 * clicks. The token is only exchanged for a session on the POST below,
 * which requires an explicit user click on the confirmation page's button.
 *
 * Why not /auth/callback: that route is PKCE-only (expects a `?code=…` and
 * a matching code_verifier cookie set by the login form). An invitee never
 * hit the login form, so PKCE can't work. Supabase's own generateLink
 * `action_link` also can't feed /auth/callback for the same reason — it
 * redirects back with a `#access_token` hash the server can't read.
 * verifyOtp({token_hash, type}) is the officially-supported server-side
 * exchange for this scenario.
 *
 * client_id names the client this specific invite is for — carried through
 * so that after verifyOtp we can confirm the invited email actually has a
 * membership row for that client before redirecting (an email can belong to
 * more than one client's workspace, so guessing "the first row" risks
 * landing an invite for client B inside client A).
 *
 * All redirects use APP_URL (via getPublicOrigin) instead of request.url —
 * on Render, request.url is the internal localhost:PORT address.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { randomUUID, timingSafeEqual } from 'crypto'
import { getPublicOrigin } from '@/lib/auth/public-origin'
import { resolveRedirectForSession, INVITE_INVALID_REDIRECT } from '@/lib/auth/resolve-redirect'

export const dynamic = 'force-dynamic'

// The full set of EmailOtpType strings GoTrue can report back as
// `properties.verification_type` from admin.generateLink — see the
// verifyOtp comment below for why we now trust that value over a guess.
const ALLOWED_TYPES = new Set(['invite', 'magiclink', 'signup', 'recovery', 'email_change', 'email'])

// Short-lived, one-time same-site nonce cookie. Prevents a login-CSRF where
// an attacker's cross-origin form POSTs their own invite token into a
// victim's browser and mints a session under the attacker's account. The
// cookie is scoped to /auth/invite-landing so no other route can read it,
// SameSite=Strict so it never rides a cross-site POST, HttpOnly so page JS
// can't leak it, and one-time — it is deleted on every POST response,
// success or failure.
const NONCE_COOKIE = 'me-invite-nonce'
const NONCE_MAX_AGE_SECONDS = 600 // 10 min; the confirmation is a single click

// client_id must be a UUID — the ONLY shape our clients table issues. A blank
// or malformed value would earlier flow through as `expectedClientId=undefined`
// and let the invite land wherever the email happened to have membership
// (wrong-customer break). Reject those in both GET and POST before any
// verifyOtp / session work runs.
const CLIENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isValidClientId(v: unknown): v is string {
  return typeof v === 'string' && CLIENT_ID_RE.test(v)
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
  ))
}

function confirmPage(tokenHash: string, type: string, clientId: string, nonce: string): string {
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>确认邀请</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#f7f7f8;margin:0}
.card{background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1);max-width:360px;text-align:center}
p{color:#333;font-size:15px}
button{margin-top:16px;padding:12px 24px;border:none;border-radius:8px;background:#111;color:#fff;font-size:16px;cursor:pointer}
</style></head>
<body><div class="card">
<p>点击下方按钮进入你的工作区</p>
<form method="POST">
<input type="hidden" name="token_hash" value="${escapeHtml(tokenHash)}"/>
<input type="hidden" name="type" value="${escapeHtml(type)}"/>
<input type="hidden" name="client_id" value="${escapeHtml(clientId)}"/>
<input type="hidden" name="nonce" value="${escapeHtml(nonce)}"/>
<button type="submit">进入工作区</button>
</form>
</div></body></html>`
}

export async function GET(request: NextRequest) {
  const origin = getPublicOrigin(request)
  const { searchParams } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const clientId = searchParams.get('client_id') ?? ''

  const failedUrl = `${origin}/portal/login?error=invite_invalid`

  if (!tokenHash || !type || !ALLOWED_TYPES.has(type) || !isValidClientId(clientId)) {
    // No nonce cookie is set on this reject path — a malformed GET must
    // consume nothing (no token verify, no bound cookie), so a scanner or
    // typo cannot seed a usable confirmation state for anyone else.
    return NextResponse.redirect(failedUrl)
  }

  // Mint a fresh nonce and bind it to the response — the POST handler will
  // require both the form-field copy and the cookie copy to match. GET does
  // NOT verifyOtp: mail security scanners can prefetch this URL, but all
  // they get is an HTML page and a nonce cookie THEY cannot forward to the
  // POST handler across an origin boundary.
  const nonce = randomUUID()
  const response = new NextResponse(confirmPage(tokenHash, type, clientId, nonce), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
  response.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'strict',
    // In dev over http the browser drops Secure attribute; in prod (https)
    // it enforces it. Derive from the resolved public origin so localhost
    // testing still works while production keeps the strict cookie.
    secure: origin.startsWith('https://'),
    path: '/auth/invite-landing',
    maxAge: NONCE_MAX_AGE_SECONDS,
  })
  return response
}

export async function POST(request: NextRequest) {
  const origin = getPublicOrigin(request)
  const form = await request.formData()
  const tokenHash = form.get('token_hash')
  const type = form.get('type')
  const clientId = form.get('client_id')
  const submittedNonce = form.get('nonce')

  const failedUrl = `${origin}/portal/login?error=invite_invalid`

  // Build a fail-closed response that also burns the nonce cookie so a
  // second attempt cannot replay it. Always call this on any reject path.
  const failResponse = () => {
    const r = NextResponse.redirect(failedUrl, 303)
    r.cookies.delete({ name: NONCE_COOKIE, path: '/auth/invite-landing' })
    return r
  }

  // ── CSRF gate 1: same-origin. Modern browsers always send Origin on
  // POST; a missing Origin is unsafe (older client / stripped by proxy)
  // and rejected. Canonical origin comes from APP_URL via getPublicOrigin,
  // NOT from any request header, so a spoofed Host can't win.
  const canonical = origin.replace(/\/$/, '')
  const requestOrigin = request.headers.get('origin')
  if (!requestOrigin || requestOrigin.replace(/\/$/, '') !== canonical) {
    return failResponse()
  }

  // ── CSRF gate 2: one-time same-site nonce issued by the GET above.
  // Compared in constant time to defeat timing side-channels.
  const cookieStore = cookies()
  const cookieNonce = cookieStore.get(NONCE_COOKIE)?.value
  if (
    typeof submittedNonce !== 'string' || !submittedNonce ||
    !cookieNonce ||
    !timingSafeEqualStrings(submittedNonce, cookieNonce)
  ) {
    return failResponse()
  }

  // Shape validation happens AFTER CSRF gates so an attacker probing shape
  // errors can't distinguish "your CSRF failed" from "your payload was
  // malformed" — both fail closed identically. client_id must be a UUID:
  // a missing/blank/truncated value would collapse expectedClientId to
  // undefined downstream and let the invite land in whichever other client
  // this email happens to hold (wrong-customer break).
  if (
    typeof tokenHash !== 'string' || !tokenHash ||
    typeof type !== 'string' || !ALLOWED_TYPES.has(type) ||
    !isValidClientId(clientId)
  ) {
    return failResponse()
  }

  const pendingCookies: Array<{ name: string; value: string; options?: Record<string, unknown> }> = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(list) {
          list.forEach(({ name, value, options }) => {
            pendingCookies.push({ name, value, options: options as Record<string, unknown> })
          })
        },
      },
    },
  )

  // Pass through the EXACT type Supabase's admin.generateLink reported back
  // in `properties.verification_type` when the token was minted (see
  // generate-invite-link.ts) — NOT a value we guess here. Two prior guesses
  // both failed the same production journey: the raw requested type
  // ('invite' / 'magiclink' — Ray canary 2026-08-27 03:27:09 NZST) and the
  // hardcoded unified 'email' used by the sibling /api/auth/verify-otp route
  // (Ray canary 2026-08-27 04:41:04 NZST) — that sibling route verifies a
  // DIFFERENT GoTrue contract ({email, token} numeric-OTP) than this one
  // ({token_hash} link-hash), so its 'email' constant does not transfer.
  // `type` is still shape-validated against ALLOWED_TYPES above; it is now
  // also the actual verifyOtp discriminator, sourced end-to-end from GoTrue
  // itself instead of assumed on either side of the contract.
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as 'invite' | 'magiclink' | 'signup' | 'recovery' | 'email_change' | 'email',
  })

  if (error) {
    console.error('[auth/invite-landing] verifyOtp:', error.message)
    return failResponse()
  }

  // verifyOtp succeeded, but explicitly confirm we can read the session
  // identity BEFORE trusting downstream landing logic. If getUser can't
  // return a user/email (transient auth error, revoked mid-flight, edge
  // cookie desync), resolveRedirectForSession would fall through to the
  // safePath /dashboard and middleware could route to some OTHER client
  // this email happens to hold membership in. Fail closed here instead.
  const { data: { user: verifiedUser } } = await supabase.auth.getUser()
  if (!verifiedUser?.email) {
    console.warn('[auth/invite-landing] fail-closed: verifyOtp returned no user/email')
    return failResponse()
  }

  // Reuse the exact same landing decision the OTP + Google flows use — so
  // an invite from a portal client goes to /portal/<id>, dashboard client
  // goes to /dashboard/clients/<id>, admins go to /dashboard, etc. Scoped to
  // this invite's client_id (validated as UUID above) so the email's other
  // client memberships can't hijack the redirect.
  const expectedClientId = clientId as string
  const destination = await resolveRedirectForSession(supabase, '/dashboard', expectedClientId)

  if (destination === INVITE_INVALID_REDIRECT) {
    // The token verified fine, but this email has no membership row for the
    // invited client_id anymore (revoked, or the invite predates a schema
    // change). Do NOT apply the pending session cookies — leaving the
    // invitee unauthenticated is the fail-closed behaviour required by
    // Build Control. Skipping the setAll means verifyOtp's server-side
    // confirm side effects stay, but no browser cookie is minted, so no
    // downstream middleware can decide to land them in another client.
    console.warn(
      '[auth/invite-landing] fail-closed: no membership for invited client_id',
      { clientId: expectedClientId },
    )
    return failResponse()
  }

  const response = NextResponse.redirect(`${origin}${destination}`, 303)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options as any))
  // Burn the nonce on success too — one confirmation click, one session.
  response.cookies.delete({ name: NONCE_COOKIE, path: '/auth/invite-landing' })
  return response
}
