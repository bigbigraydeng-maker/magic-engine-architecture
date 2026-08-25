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
import { getPublicOrigin } from '@/lib/auth/public-origin'
import { resolveRedirectForSession, INVITE_INVALID_REDIRECT } from '@/lib/auth/resolve-redirect'

export const dynamic = 'force-dynamic'

const ALLOWED_TYPES = new Set(['invite', 'magiclink'])

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
  ))
}

function confirmPage(tokenHash: string, type: string, clientId: string): string {
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

  return new NextResponse(confirmPage(tokenHash, type, clientId), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

export async function POST(request: NextRequest) {
  const origin = getPublicOrigin(request)
  const form = await request.formData()
  const tokenHash = form.get('token_hash')
  const type = form.get('type')
  const clientId = form.get('client_id')

  const failedUrl = `${origin}/portal/login?error=invite_invalid`

  if (typeof tokenHash !== 'string' || !tokenHash || typeof type !== 'string' || !ALLOWED_TYPES.has(type)) {
    return NextResponse.redirect(failedUrl, 303)
  }

  const cookieStore = cookies()
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
    return NextResponse.redirect(failedUrl, 303)
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
    return NextResponse.redirect(failedUrl, 303)
  }

  const response = NextResponse.redirect(`${origin}${destination}`, 303)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options as any))
  return response
}
