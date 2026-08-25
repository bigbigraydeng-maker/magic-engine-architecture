/**
 * GET  /auth/invite-landing?token_hash=<h>&type=invite|magiclink&client_id=<id>
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

const ALLOWED_TYPES = new Set(['invite', 'magiclink'])

// Short-lived, one-time same-site nonce cookie. Prevents a login-CSRF where
// an attacker's cross-origin form POSTs their own invite token into a
// victim's browser and mints a session under the attacker's account. The
// cookie is scoped to /auth/invite-landing so no other route can read it,
// SameSite=Strict so it never rides a cross-site POST, HttpOnly so page JS
// can't leak it, and one-time — it is deleted on every POST response,
// success or failure.
const NONCE_COOKIE = 'me-invite-nonce'
const NONCE_MAX_AGE_SECONDS = 600 // 10 min; the confirmation is a single click

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

  if (!tokenHash || !type || !ALLOWED_TYPES.has(type)) {
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
  // malformed" — both fail closed identically.
  if (typeof tokenHash !== 'string' || !tokenHash || typeof type !== 'string' || !ALLOWED_TYPES.has(type)) {
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

  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as 'invite' | 'magiclink',
  })

  if (error) {
    console.error('[auth/invite-landing] verifyOtp:', error.message)
    return failResponse()
  }

  // Reuse the exact same landing decision the OTP + Google flows use — so
  // an invite from a portal client goes to /portal/<id>, dashboard client
  // goes to /dashboard/clients/<id>, admins go to /dashboard, etc. Scoped to
  // this invite's client_id (when present) so the email's other client
  // memberships can't hijack the redirect.
  const expectedClientId = typeof clientId === 'string' && clientId ? clientId : undefined
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
