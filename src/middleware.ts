import { NextRequest, NextResponse } from 'next/server'
import { createMiddlewareSupabaseClient } from '@/lib/supabase-server'
import { getUserPermissions } from '@/lib/auth/whitelist'
import { supabaseAdmin } from '@/lib/supabase'

export async function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  const supabase = createMiddlewareSupabaseClient(request, response)

  const { data: { user } } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname

  // ── Portal routes (/portal/*) ─────────────────────────────────────────────
  if (path.startsWith('/portal')) {
    if (!user) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('next', path)
      return NextResponse.redirect(loginUrl)
    }

    // Look up ALL clients this user can access
    const { data: portalUsers } = await supabaseAdmin
      .from('client_portal_users')
      .select('client_id')
      .eq('email', (user.email ?? '').toLowerCase())

    if (!portalUsers || portalUsers.length === 0) {
      return NextResponse.redirect(new URL('/unauthorized', request.url))
    }

    const allowedClientIds = portalUsers.map((p) => p.client_id)

    // /portal root → redirect to first allowed client
    if (path === '/portal') {
      return NextResponse.redirect(new URL(`/portal/${allowedClientIds[0]}`, request.url))
    }

    // Extract clientId from /portal/{clientId}/...
    const pathClientId = path.split('/')[2]
    if (!pathClientId || !allowedClientIds.includes(pathClientId)) {
      return NextResponse.redirect(new URL(`/portal/${allowedClientIds[0]}`, request.url))
    }

    requestHeaders.set('x-user-role', 'client-viewer')
    requestHeaders.set('x-allowed-client-id', pathClientId)
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  // ── Dashboard routes (/dashboard/*) ──────────────────────────────────────
  if (!user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', path)
    return NextResponse.redirect(loginUrl)
  }

  const permissions = getUserPermissions(user.email ?? '')

  if (!permissions) {
    return NextResponse.redirect(new URL('/unauthorized', request.url))
  }

  // Restrict client-viewer to their assigned client only
  if (permissions.role === 'client-viewer' && permissions.allowedClientId) {
    const allowedBase = `/dashboard/clients/${permissions.allowedClientId}`
    if (!path.startsWith(allowedBase)) {
      return NextResponse.redirect(new URL(allowedBase, request.url))
    }
  }

  requestHeaders.set('x-user-role', permissions.role)
  if (permissions.allowedClientId) {
    requestHeaders.set('x-allowed-client-id', permissions.allowedClientId)
  }

  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/dashboard/:path*', '/portal/:path*'],
}
