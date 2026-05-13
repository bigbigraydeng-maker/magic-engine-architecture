/**
 * GET /api/clients/[id]/prescriptions/latest-draft
 *
 * 返回该客户最近一份非废弃的处方（status IN draft/generating/failed）。
 * 用于前端 mount 时恢复"刚生成的草稿"，避免用户刷新后丢失结果。
 *
 * 404 若没有任何处方。
 * Security: Bearer token (INTERNAL_API_KEY)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import type { Prescription } from '@/types/diagnostic'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const { id: clientId } = params

    const { data, error } = await supabaseAdmin
      .from('prescriptions')
      .select('*')
      .eq('client_id', clientId)
      .in('status', ['draft', 'generating', 'failed'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<Prescription>()

    if (error) {
      console.error('[prescriptions/latest-draft] db error', error)
      return NextResponse.json({ success: false, error: 'DB error' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ success: false, error: 'No draft prescription' }, { status: 404 })
    }

    return NextResponse.json({ success: true, prescription: data }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    })
  } catch (err: unknown) {
    console.error('[prescriptions/latest-draft] error', err)
    return NextResponse.json({ success: false, error: 'Unexpected error' }, { status: 500 })
  }
}
