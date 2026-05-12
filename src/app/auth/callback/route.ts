import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

/**
 * Resolve the public-facing origin in order of reliability:
 * 1. NEXT_PUBLIC_APP_URL env var (explicit, most reliable)
 * 2. x-forwarded-host header (set by Render / reverse proxies)
 * 3. request.nextUrl.origin (may be localhost:10000 on Render — last resort)
 */
function getPublicOrigin(request: NextRequest): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  }
  const forwardedHost = request.headers.get('x-forwarded-host')
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  if (forwardedHost) return `${proto}://${forwardedHost}`
  return request.nextUrl.origin
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  // Prevent open redirect: only allow relative paths
  const safePath = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'

  const origin = getPublicOrigin(request)

  if (code) {
    const supabase = createServerSupabaseClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL(safePath, origin))
    }
  }

  return NextResponse.redirect(new URL('/login?error=auth_failed', origin))
}
