/**
 * PATCH /api/clients/[id]/execution/[itemId]
 *
 * 更新执行项 —— 支持状态变更 + 标题/说明编辑（处方"活化" P8.10.S5.2）。
 * 所有变更自动写入 execution_logs 时间线。
 *
 * Body（status / title / description 至少一项）: {
 *   status?:      'pending' | 'in_progress' | 'completed' | 'skipped'
 *   title?:       string   — 编辑标题
 *   description?: string   — 编辑说明
 *   note?:        string   — 可选，附带一条 FDE 备注
 * }
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.10.S4.1 / S5.2
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
    const body = (await req.json()) as {
      status?: ExecutionItemStatus
      title?: string
      description?: string
      note?: string
    }

    const newTitle = typeof body.title === 'string' ? body.title.trim() : undefined
    const newDesc = typeof body.description === 'string' ? body.description.trim() : undefined
    const hasStatus = body.status != null
    const hasEdit = newTitle !== undefined || newDesc !== undefined

    if (!hasStatus && !hasEdit) {
      return NextResponse.json(
        { success: false, error: 'status / title / description 至少要有一项' },
        { status: 400 },
      )
    }
    if (hasStatus && !VALID_STATUSES.includes(body.status!)) {
      return NextResponse.json(
        { success: false, error: `status must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 },
      )
    }

    // 先读当前记录（status_change / 编辑前后对比）
    const { data: current, error: readErr } = await supabaseAdmin
      .from('execution_items')
      .select('status, started_at, title, description')
      .eq('id', itemId)
      .eq('client_id', clientId)
      .single<{
        status: ExecutionItemStatus; started_at: string | null
        title: string; description: string
      }>()

    if (readErr || !current) {
      return NextResponse.json({ success: false, error: 'Execution item not found' }, { status: 404 })
    }

    const patch: Record<string, unknown> = {}
    const nowIso = new Date().toISOString()
    if (hasStatus) {
      patch.status = body.status
      if (body.status === 'completed') patch.completed_at = nowIso
      if (body.status === 'in_progress' && !current.started_at) patch.started_at = nowIso
    }
    if (newTitle !== undefined && newTitle) patch.title = newTitle
    if (newDesc !== undefined && newDesc) patch.description = newDesc

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
    if (hasStatus && current.status !== body.status) {
      logs.push({
        execution_item_id: itemId,
        client_id:         clientId,
        author:            'system',
        kind:              'status_change',
        content:           `状态：${STATUS_LABEL[current.status]} → ${STATUS_LABEL[body.status!]}`,
        meta:              { from: current.status, to: body.status },
      })
    }
    // 编辑标题/说明 → adjustment 日志
    const editedFields: string[] = []
    if (newTitle !== undefined && newTitle && newTitle !== current.title) editedFields.push('标题')
    if (newDesc !== undefined && newDesc && newDesc !== current.description) editedFields.push('说明')
    if (editedFields.length > 0) {
      logs.push({
        execution_item_id: itemId,
        client_id:         clientId,
        author:            'fde',
        kind:              'adjustment',
        content:           `FDE 修改了执行项的${editedFields.join('、')}`,
        meta:              { adjustment: 'edit', fields: editedFields },
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
