import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess, requirePaidClientAccess } from '@/lib/auth/client-access'
import { ACCESS_TYPE_VALUES } from '@/lib/auth/access-types'
import { sendPortalInviteForClient } from '@/lib/email/send-portal-invite-for-client'

type Params = { params: { id: string } }

// GET /api/clients/[id]/users — list members of this client.
// Phase X.S2 boundary ③: read-only is open to every tier (incl. self_serve)
// so a free user can see who else is on the workspace; the mutating handlers
// below are paid-only so self-serve cannot grow the bonus farm.
export async function GET(_req: NextRequest, { params }: Params) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  const { data, error } = await supabaseAdmin
    .from('client_portal_users')
    .select('id, email, display_name, access_type, created_at')
    .eq('client_id', params.id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, users: data ?? [] })
}

// POST /api/clients/[id]/users — add or update a user's access. Paid only.
export async function POST(req: NextRequest, { params }: Params) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  const body = await req.json()
  const email: string = (body.email ?? '').toLowerCase().trim()
  const display_name: string = (body.display_name ?? '').trim()
  const access_type: string = body.access_type ?? 'portal'

  if (!email) return NextResponse.json({ success: false, error: '邮箱不能为空' }, { status: 400 })
  if (!ACCESS_TYPE_VALUES.includes(access_type as typeof ACCESS_TYPE_VALUES[number])) {
    return NextResponse.json({ success: false, error: '无效的 access_type' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('client_portal_users')
    .upsert(
      { email, client_id: params.id, display_name, access_type },
      { onConflict: 'email,client_id' }
    )
    .select('id, email, display_name, access_type, created_at')
    .single()

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  // Row race note: two concurrent adds for the same (email, client_id) both
  // succeed the upsert but only one is the actual create. Decide "isNew" by
  // whether the row's created_at is within the last few seconds of NOW —
  // reading a pre-existing row from the upsert result returns its original
  // created_at, so the second concurrent request sees it's old and skips the
  // duplicate invite. Requires clock skew < INVITE_CREATED_WITHIN_MS.
  const INVITE_CREATED_WITHIN_MS = 5_000
  const createdAt = data?.created_at ? new Date(data.created_at).getTime() : 0
  const isNew = Date.now() - createdAt < INVITE_CREATED_WITHIN_MS

  let invite: { sent: boolean; reason?: string } | undefined
  if (isNew) {
    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('name')
      .eq('id', params.id)
      .maybeSingle()
    invite = await sendPortalInviteForClient({
      email,
      clientName: client?.name ?? '',
      displayName: display_name,
    })
    if (!invite.sent) {
      console.warn('[api/clients/[id]/users] invite email not sent:', invite.reason)
    }
  }

  return NextResponse.json({ success: true, user: data, invite })
}

// DELETE /api/clients/[id]/users — remove a user by email. Paid only.
export async function DELETE(req: NextRequest, { params }: Params) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  const body = await req.json()
  const email: string = (body.email ?? '').toLowerCase().trim()

  if (!email) return NextResponse.json({ success: false, error: '邮箱不能为空' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('client_portal_users')
    .delete()
    .eq('client_id', params.id)
    .eq('email', email)

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
