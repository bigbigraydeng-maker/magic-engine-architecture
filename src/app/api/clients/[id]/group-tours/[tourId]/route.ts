import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET   /api/clients/[id]/group-tours/[tourId]   —— 单条详情
 * PATCH /api/clients/[id]/group-tours/[tourId]   —— 人工编辑保存
 *
 * required_fields_confirmed 是后端发布闸校验用的字段（板桥意见4 / 魏征 B4、W4），
 * 不能靠前端"记得别忘了重置"这种约定：只要这次请求改了 payload，就必须在
 * 同一次请求里显式传 required_fields_confirmed:true 才会保持"已确认"状态，
 * 否则一律强制退回 false —— 防止"改了价格但没人重新看一眼"的确认状态失真。
 */

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string; tourId: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { data, error } = await supabaseAdmin
    .from('group_tours')
    .select('*')
    .eq('id', params.tourId)
    .eq('client_id', params.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: '找不到这个团' }, { status: 404 })
  return NextResponse.json({ tour: data })
}

interface PatchBody {
  title?: string
  slug?: string
  payload?: Record<string, unknown>
  required_fields_confirmed?: boolean
  status?: 'draft' | 'review' | 'ready' | 'archived'
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; tourId: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  if (typeof body.title === 'string') update.title = body.title
  if (typeof body.slug === 'string') update.slug = body.slug
  if (body.payload && typeof body.payload === 'object') update.payload = body.payload
  if (body.status) update.status = body.status

  if ('payload' in update) {
    update.required_fields_confirmed = body.required_fields_confirmed === true
  } else if (typeof body.required_fields_confirmed === 'boolean') {
    update.required_fields_confirmed = body.required_fields_confirmed
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: '没有要保存的内容' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('group_tours')
    .update(update)
    .eq('id', params.tourId)
    .eq('client_id', params.id)
    .select('*')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: '找不到这个团' }, { status: 404 })
  return NextResponse.json({ tour: data })
}
