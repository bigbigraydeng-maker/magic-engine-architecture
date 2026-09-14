/**
 * POST /api/admin/conversions/ai-auto-review-run —— 手动触发一轮 AI 全自动审核
 * （PM 拍板 2026-09-15："成交审核换成 AI 直接判断，不要人再点一下"）。
 *
 * 只有手动触发，没有接 Inngest 定时——见 `ai-auto-review-run.ts` 文件头说明：
 * 这次风险比"只写 pending_review、人还要再点一次"的现有先例（NAL 私信同步/CTS 表格
 * 同步）更高，先跑几天观察判断质量和熔断阈值，再评估要不要接定时。
 *
 * 鉴权用 `guardAdmin`——这是全局管理员级别的操作入口（可以一次处理多个客户），
 * 不是某个客户自己能碰的东西。
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'
import { runAiAutoReviewForClient, type RunSummary } from '@/lib/conversions/ai-auto-review-run'
import { metaCapiWriter } from '@/lib/meta/capi/writer'

export const dynamic = 'force-dynamic'

interface Body {
  /** 只跑这一个客户；不传就跑所有开了 `ai_auto_review_enabled` 的客户。 */
  clientId?: unknown
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    body = {}
  }
  const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : ''

  let clientIds: string[]
  if (clientId) {
    clientIds = [clientId]
  } else {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('ai_auto_review_enabled', true)
    if (error) return NextResponse.json({ error: `读取客户列表失败：${error.message}` }, { status: 500 })
    clientIds = ((data ?? []) as { id: string }[]).map((c) => c.id)
  }

  const results: Record<string, RunSummary> = {}
  for (const id of clientIds) {
    try {
      results[id] = await runAiAutoReviewForClient(id, {
        supabase: supabaseAdmin,
        sendDeps: { writer: metaCapiWriter, fetcher: fetch },
      })
    } catch (e) {
      results[id] = { ran: false, reason: 'error', detail: e instanceof Error ? e.message : String(e) }
    }
  }

  return NextResponse.json({ results })
}
