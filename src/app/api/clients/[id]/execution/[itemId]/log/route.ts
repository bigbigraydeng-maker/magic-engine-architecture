/**
 * POST /api/clients/[id]/execution/[itemId]/log
 *
 * FDE 给执行项添加一条工作日志（鲁班执行代理 P8.10.S4.1）。
 *
 * Body: {
 *   kind:    'note' | 'blocker'   — 默认 'note'
 *   content: string              — 日志内容
 * }
 *
 * Returns: { success, log }
 * Security: Bearer token (INTERNAL_API_KEY)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import type { ExecutionLog, ExecutionLogKind } from '@/types/diagnostic'

export const dynamic = 'force-dynamic'

// FDE 手动可写的类型（ai_assist/status_change/adjustment 由系统/鲁班写）
const FDE_KINDS: ExecutionLogKind[] = ['note', 'blocker']

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } },
): Promise<NextResponse> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const { id: clientId, itemId } = params
    const body = (await req.json()) as { kind?: ExecutionLogKind; content?: string }

    const kind: ExecutionLogKind =
      body.kind && FDE_KINDS.includes(body.kind) ? body.kind : 'note'
    const content = (body.content ?? '').trim()

    if (!content) {
      return NextResponse.json({ success: false, error: 'content is required' }, { status: 400 })
    }

    // 校验执行项存在且属于该客户
    const { data: item, error: itemErr } = await supabaseAdmin
      .from('execution_items')
      .select('id')
      .eq('id', itemId)
      .eq('client_id', clientId)
      .single<{ id: string }>()

    if (itemErr || !item) {
      return NextResponse.json({ success: false, error: 'Execution item not found' }, { status: 404 })
    }

    const { data: log, error: insertErr } = await supabaseAdmin
      .from('execution_logs')
      .insert({
        execution_item_id: itemId,
        client_id:         clientId,
        author:            'fde',
        kind,
        content,
        meta:              null,
      })
      .select('*')
      .single<ExecutionLog>()

    if (insertErr || !log) {
      console.error('[execution/:itemId/log POST] insert failed:', insertErr)
      return NextResponse.json({ success: false, error: 'Failed to add log' }, { status: 500 })
    }

    return NextResponse.json({ success: true, log })
  } catch (err: unknown) {
    console.error('[execution/:itemId/log POST] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}
