import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { EMPTY_GROUP_TOUR_PAYLOAD } from '@/lib/group-tours/types'

/**
 * GET  /api/clients/[id]/group-tours       —— 列表（默认排除 archived）
 * POST /api/clients/[id]/group-tours       —— 建一条空草稿，回上传/编辑页
 */

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { data, error } = await supabaseAdmin
    .from('group_tours')
    .select('id,status,title,slug,payload,pr_url,pr_number,published_at,updated_at,created_at')
    .eq('client_id', params.id)
    .neq('status', 'archived')
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tours: data ?? [] })
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { data, error } = await supabaseAdmin
    .from('group_tours')
    .insert({ client_id: params.id, status: 'draft', payload: EMPTY_GROUP_TOUR_PAYLOAD })
    .select('id,status,title,slug,payload')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tour: data })
}
