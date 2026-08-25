/**
 * GET /auth/invite-landing?token_hash=<h>&type=invite|magiclink
 *
 * Landing endpoint for the "you've been invited" email. The invitee's first
 * click lands here — we trade the hashed token for a session and redirect
 * them straight into their workspace. NO login form, NO password.
 *
 * Why not /auth/callback: that route is PKCE-only (expects a `?code=…` and
 * a matching code_verifier cookie set by the login form). An invitee never
 * hit the login form, so PKCE can't work. Supabase's own generateLink
 * `action_link` also can't feed /auth/callback for the same reason — it
 * redirects back with a `#access_token` hash the server can't read.
 * verifyOtp({token_hash, type}) is the officially-supported server-side
 * exchange for this scenario.
 *
 * All redirects use APP_URL (via getPublicOrigin) instead of request.url —
 * on Render, request.url is the internal localhost:PORT address.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getPublicOrigin } from '@/lib/auth/public-origin'
import { resolveRedirectForSession } from '@/lib/auth/resolve-redirect'

export const dynamic = 'force-dynamic'

const ALLOWED_TYPES = new Set(['invite', 'magiclink'])

export async function GET(request: NextRequest) {
  const origin = getPublicOrigin(request)
  const { searchParams } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')

  const failedUrl = `${origin}/portal/login?error=invite_invalid`

  if (!tokenHash || !type || !ALLOWED_TYPES.has(type)) {
    return NextResponse.redirect(failedUrl)
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
    return NextResponse.redirect(failedUrl)
  }

  // Reuse the exact same landing decision the OTP + Google flows use — so
  // an invite from a portal client goes to /portal/<id>, dashboard client
  // goes to /dashboard/clients/<id>, admins go to /dashboard, etc.
  const destination = await resolveRedirectForSession(supabase, '/dashboard')

  const response = NextResponse.redirect(`${origin}${destination}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options as any))
  return response
}
