/**
 * GET /api/clients/[id]/business-inbox/conversations/[conversationId]/messages
 *
 * 一条 Outlook 邮件对话的安全查看视图：这条线程的每一封信（最小安全内容）+
 * 这个人的已存 CRM 阶段分析。全程只读。
 *
 * 隔离（Risk A）—— 这是最容易泄露「另一个客户存不存在这封邮件」的地方：
 *   - `requirePaidClientAccess` 在任何查询之前先跑。
 *   - `conversationId` 先过 `isUuid`；不合法直接 404，**不发查询**，
 *     且和「不存在 / 属于别的客户」返回**完全一样**的 404，不给存在性预言机。
 *   - 取对话时同时绑 `id + client_id + channel='email'`。属于别的客户、
 *     或不是邮件渠道、或压根不存在 → 一律 `maybeSingle()` 得到 null → 同一个 404。
 *   - 信按已验证归属的 `conversation_id` 取，只 select 最小列：
 *     方向 / 发件人显示名 / 正文预览 / 时间。
 *     **不返回** message_id（provider 的 Graph 消息 id，是标识符）、
 *     也没有任何附件字段（库里根本不存附件的字节/URL/文件名/标识符）。
 *
 * Responses:
 *   200  { conversation, messages, analysis }
 *   401  not authenticated
 *   403  not a member of this client
 *   404  malformed id / not found / cross-tenant / non-email —— 一律同一个响应
 *   500  query failed
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { isUuid } from '@/lib/validation-utils'
import {
  resolveStageAnalysis,
  StageAnalysisError,
  type StageAnalysis,
} from '@/lib/business-inbox/stage-analysis'

interface RouteParams {
  params: { id: string; conversationId: string }
}

/**
 * 一条线程最多显示多少封（Codex PATCH1 P2/P4）。
 *
 * 按**最新在前**取这么多，再翻回正序显示 —— 最新的邮件永远看得到，不会被
 * 早年的几百封信顶到看不见。窄分页，不是无限滚动框架；更旧的用 `olderTruncated`
 * 如实标出来，不假装全给了。
 */
const MESSAGE_LIMIT = 200

interface ConversationRow {
  id: string
  subject: string | null
  participant_name: string | null
  contact_id: string | null
}

interface MessageRow {
  direction: 'inbound' | 'outbound'
  sender_name: string | null
  body: string | null
  sent_at: string | null
}

export interface InboxMessage {
  direction: 'inbound' | 'outbound'
  senderName: string | null
  /** 邮件正文预览（同步时存的短摘要，不是全文，也不含任何附件）。 */
  body: string | null
  sentAt: string | null
}

export interface InboxConversationDetail {
  conversation: { id: string; subject: string | null; participantName: string | null }
  messages: InboxMessage[]
  /** true = 这条线程更早的邮件没全给，只显示了最新的一批。 */
  olderTruncated: boolean
  analysis: StageAnalysis | null
}

/** 存在性预言机的统一出口：不合法 / 不存在 / 跨租户 / 非邮件，都走这一个。 */
function notFound(): NextResponse {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

/** 取这条对话本身，绑 id + client_id + channel='email'。跨租户/非邮件/不存在都判 notfound。 */
type ConversationFetch =
  | { status: 'ok'; conv: ConversationRow }
  | { status: 'error' }
  | { status: 'notfound' }

async function fetchEmailConversation(
  clientId: string,
  conversationId: string,
): Promise<ConversationFetch> {
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('id, subject, participant_name, contact_id')
    .eq('id', conversationId)
    .eq('client_id', clientId)
    .eq('channel', 'email')
    .maybeSingle()

  if (error) return { status: 'error' }
  // 属于别的客户 / 非邮件渠道 / 不存在 → 都是 null → 同一个 notfound，无预言机。
  if (!data) return { status: 'notfound' }
  return { status: 'ok', conv: data as unknown as ConversationRow }
}

/** 按最新在前取 MESSAGE_LIMIT+1 封 —— 多取一封只为判断还有没有更旧的。 */
async function fetchLatestMessageRows(
  conversationId: string,
): Promise<{ ok: true; rowsDesc: MessageRow[] } | { ok: false }> {
  const { data, error } = await supabaseAdmin
    .from('conversation_messages')
    .select('direction, sender_name, body, sent_at')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: false })
    .limit(MESSAGE_LIMIT + 1)

  if (error) return { ok: false }
  return { ok: true, rowsDesc: (data ?? []) as unknown as MessageRow[] }
}

/** 把「最新在前」的库行翻成「旧→新」显示，并如实标出是否截断。纯函数。 */
function toLatestWindow(rowsDesc: MessageRow[]): {
  messages: InboxMessage[]
  olderTruncated: boolean
} {
  const olderTruncated = rowsDesc.length > MESSAGE_LIMIT
  // 丢掉多取的那一封，翻回正序（旧→新）—— 最新那封一定在里面。
  const shown = (olderTruncated ? rowsDesc.slice(0, MESSAGE_LIMIT) : rowsDesc).slice().reverse()
  return {
    olderTruncated,
    messages: shown.map((m) => ({
      direction: m.direction,
      senderName: m.sender_name,
      body: m.body,
      sentAt: m.sent_at,
    })),
  }
}

/**
 * 取这个人的已存阶段分析；取数失败返回 { ok:false } 让路由变 500，
 * 不静默降级成「暂无分析」。没有关联联系人就是 ok + null（真的没有）。
 */
async function resolveAnalysisSafe(
  clientId: string,
  contactId: string | null,
): Promise<{ ok: true; analysis: StageAnalysis | null } | { ok: false }> {
  if (!contactId) return { ok: true, analysis: null }
  try {
    const map = await resolveStageAnalysis(clientId, [contactId])
    return { ok: true, analysis: map.get(contactId) ?? null }
  } catch (err) {
    if (err instanceof StageAnalysisError) return { ok: false }
    throw err
  }
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const clientId = params.id
  const conversationId = params.conversationId

  // 鉴权在最前面：不通过就返回，下面一条查询都不会发。
  // 带上 reason，让详情路由与列表路由保持同一契约（paid_only 前端弹解锁）。
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error, reason: access.reason },
      { status: access.status },
    )
  }

  // 非法 id 直接 404，不进库 —— 跟「查不到」返回一模一样，不暴露任何存在性。
  if (!isUuid(conversationId)) return notFound()

  const convRes = await fetchEmailConversation(clientId, conversationId)
  if (convRes.status === 'error') {
    return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 })
  }
  if (convRes.status === 'notfound') return notFound()
  const conversation = convRes.conv

  const msgRes = await fetchLatestMessageRows(conversation.id)
  if (!msgRes.ok) {
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 })
  }
  const { messages, olderTruncated } = toLatestWindow(msgRes.rowsDesc)

  const ana = await resolveAnalysisSafe(clientId, conversation.contact_id)
  if (!ana.ok) {
    return NextResponse.json({ error: 'Failed to load analysis' }, { status: 500 })
  }

  const payload: InboxConversationDetail = {
    conversation: {
      id: conversation.id,
      subject: conversation.subject,
      participantName: conversation.participant_name,
    },
    messages,
    olderTruncated,
    analysis: ana.analysis,
  }
  return NextResponse.json(payload)
}
