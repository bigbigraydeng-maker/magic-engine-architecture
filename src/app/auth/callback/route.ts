import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'

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
      // After session is set, determine where to route the user
      const { data: { user } } = await supabase.auth.getUser()

      if (user?.email) {
        // Check portal users first (takes priority over safePath)
        const { data: portalUser } = await supabaseAdmin
          .from('client_portal_users')
          .select('client_id')
          .eq('email', user.email.toLowerCase())
          .maybeSingle()

        if (portalUser?.client_id) {
          return NextResponse.redirect(
            new URL(`/portal/${portalUser.client_id}`, origin)
          )
        }
      }

      return NextResponse.redirect(new URL(safePath, origin))
    }
  }

  return NextResponse.redirect(new URL('/login?error=auth_failed', origin))
}
