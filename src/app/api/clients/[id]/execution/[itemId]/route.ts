/**
 * PATCH /api/clients/[id]/execution/[itemId]
 *
 * 更新执行项状态。状态变更会自动写入 execution_logs 时间线（鲁班 P8.10.S4）。
 *
 * Body: {
 *   status: 'pending' | 'in_progress' | 'completed' | 'skipped'
 *   note?:  string   — 可选，附带一条 FDE 备注（写入 execution_logs）
 * }
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.10.S4.1
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import type { ExecutionItem, ExecutionItemStatus } from '@/types/diagnostic'

export const dynamic = 'force-dynamic'

const VALID_STATUSES: ExecutionItemStatus[] = ['pending', 'in_progress', 'completed', 'skipped']

const STATUS_LABEL: Record<ExecutionItemStatus, string> = {
  pending:     '待处理',
  in_progress: '进行中',
  completed:   '已完成',
  skipped:     '已跳过',
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } },
): Promise<NextResponse> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const { id: clientId, itemId } = params
    const body = (await req.json()) as { status?: ExecutionItemStatus; note?: string }

    if (!body.status || !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { success: false, error: `status must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 },
      )
    }

    // 先读当前状态（用于 status_change 日志的 from 字段）
    const { data: current, error: readErr } = await supabaseAdmin
      .from('execution_items')
      .select('status, started_at')
      .eq('id', itemId)
      .eq('client_id', clientId)
      .single<{ status: ExecutionItemStatus; started_at: string | null }>()

    if (readErr || !current) {
      return NextResponse.json({ success: false, error: 'Execution item not found' }, { status: 404 })
    }

    const patch: Record<string, unknown> = { status: body.status }
    const nowIso = new Date().toISOString()
    if (body.status === 'completed') {
      patch.completed_at = nowIso
    }
    // 首次进入 in_progress → 记 started_at
    if (body.status === 'in_progress' && !current.started_at) {
      patch.started_at = nowIso
    }

    const { data, error } = await supabaseAdmin
      .from('execution_items')
      .update(patch)
      .eq('id', itemId)
      .eq('client_id', clientId)
      .select('*')
      .single<ExecutionItem>()

    if (error || !data) {
      console.error('[execution/:itemId PATCH] Supabase error:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to update execution item' },
        { status: 500 },
      )
    }

    // ── 写工作日志（execution_logs）──────────────────────────────────────
    const logs: Array<Record<string, unknown>> = []
    // 状态变更日志（仅当真的变了）
    if (current.status !== body.status) {
      logs.push({
        execution_item_id: itemId,
        client_id:         clientId,
        author:            'system',
        kind:              'status_change',
        content:           `状态：${STATUS_LABEL[current.status]} → ${STATUS_LABEL[body.status]}`,
        meta:              { from: current.status, to: body.status },
      })
    }
    // 可选 FDE 备注
    if (body.note && body.note.trim()) {
      logs.push({
        execution_item_id: itemId,
        client_id:         clientId,
        author:            'fde',
        kind:              'note',
        content:           body.note.trim(),
        meta:              null,
      })
    }
    if (logs.length > 0) {
      // 日志写失败不阻塞主流程
      await supabaseAdmin.from('execution_logs').insert(logs)
        .then(({ error: logErr }) => {
          if (logErr) console.error('[execution/:itemId PATCH] log insert failed:', logErr)
        })
    }

    return NextResponse.json({ success: true, item: data })
  } catch (err: unknown) {
    console.error('[execution/:itemId PATCH] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}
