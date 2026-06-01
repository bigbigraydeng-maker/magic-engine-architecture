import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { isBriefComplete } from '@/lib/brief/completion'
import { supabaseAdmin } from '@/lib/supabase'

// GET /api/clients/[id]/brief-status
// Returns the UX gate state for self_serve clients. Admin/FDE users fail open.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    )
  }

  if (access.role === 'admin') {
    return NextResponse.json({ complete: true, gated: false, reason: 'admin' })
  }

  const email = (access.user.email ?? '').toLowerCase().trim()
  const { data: portalRow, error } = await supabaseAdmin
    .from('client_portal_users')
    .select('access_type')
    .eq('email', email)
    .eq('client_id', params.id)
    .maybeSingle()

  if (error) {
    return NextResponse.json(
      { error: 'Failed to load brief gate status' },
      { status: 500 },
    )
  }

  if (portalRow?.access_type !== 'self_serve') {
    return NextResponse.json({ complete: true, gated: false, reason: 'bypass' })
  }

  const complete = await isBriefComplete(params.id)
  return NextResponse.json({
    complete,
    gated: !complete,
    briefUrl: `/dashboard/clients/${params.id}/brief`,
  })
}
