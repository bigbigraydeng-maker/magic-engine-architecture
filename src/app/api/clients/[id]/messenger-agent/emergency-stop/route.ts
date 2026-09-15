/**
 * POST /api/clients/[id]/messenger-agent/emergency-stop
 *
 * 门户「紧急全渠道停」按钮的后端（issue #1589）。ME 内部员工（PM/FDE）在客户
 * 出事时按的那个开关——一次调用把这个客户的 Messenger + WhatsApp AI 客服
 * 自动回复都关掉，并把「谁点的、什么时候点的」写进审计记录。
 *
 * 🔴 不重新发明开关：真正的读写逻辑是 `stopAiRepliesForClient()`
 *    （`src/lib/knowledge/kill-switch.ts`），它已经在客户自助确认页
 *    （`src/app/knowledge-confirm/[requestId]/route.ts`）上线跑着，
 *    翻的是同一对 `clients.messenger_agent_enabled_messenger` /
 *    `_whatsapp` 列，写的是同一张 `client_knowledge_events` 审计表。
 *    这条路由只是给「ME 员工从门户按」这个身份多开一个入口，两个入口
 *    共用一套开关和一套审计记录，不会出现「客户看到是关的、员工看到是开的」
 *    这种双开关互相打架的情况。
 *
 * 🔴 双重确认：跟 `src/app/dashboard/admin/mcp-keys/page.tsx` 的
 *    `handleKillSwitch` 同一个模式——body 必须带 `confirm: 'STOP-ALL'`，
 *    防止前端一次误触发把正在跑的 AI 客服关掉。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { knowledgeWriteClient } from '@/lib/knowledge/admin-client'
import { stopAiRepliesForClient, KnowledgeKillSwitchError } from '@/lib/knowledge/kill-switch'

type Params = { params: { id: string } }

const CONFIRM_PHRASE = 'STOP-ALL'

export async function POST(req: NextRequest, { params }: Params) {
  const clientId = params.id

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }
  // 只有 ME 内部人员能按这个开关——客户自己的「停止 AI 回复」走的是另一条
  // 路（客户确认页），身份来源不同，不能共用这条路由。
  if (access.tier !== 'admin') {
    return NextResponse.json({ success: false, error: '只有 Magic Engine 内部人员能按这个开关' }, { status: 403 })
  }

  const actorEmail = (access.user.email ?? '').trim()
  if (!actorEmail) {
    return NextResponse.json({ success: false, error: '登录身份缺少邮箱，拒绝操作' }, { status: 403 })
  }

  let body: { confirm?: unknown; reason?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: '请求格式不对' }, { status: 400 })
  }

  if (body.confirm !== CONFIRM_PHRASE) {
    return NextResponse.json(
      { success: false, error: `需要在请求体里带上 confirm: "${CONFIRM_PHRASE}" 二次确认` },
      { status: 400 },
    )
  }

  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined

  try {
    const result = await stopAiRepliesForClient(knowledgeWriteClient(), {
      clientId,
      actorEmail,
      reason,
      source: 'portal_emergency_stop',
    })
    return NextResponse.json({ success: true, stopped: result.stopped, auditWarning: result.auditWarning })
  } catch (err) {
    const message = err instanceof KnowledgeKillSwitchError ? err.message : '关闭失败，请重试或联系 Ray'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
