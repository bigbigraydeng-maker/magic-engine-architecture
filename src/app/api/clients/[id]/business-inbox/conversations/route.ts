/**
 * GET /api/clients/[id]/business-inbox/conversations
 *
 * 客户自己的商务收件箱列表：这个客户已同步进来的 **Outlook 邮件**对话，
 * 一条对话一行，配上「CRM 判到哪一步」的已存分析。
 *
 * 全程只读：不发信、不问模型、不碰 provider。分析读自 `contacts.stage`
 * （由 `src/lib/crm/stage-infer.ts` 早就算好落库的），这里只取出来显示。
 *
 * 隔离（Risk A）：
 *   - `requirePaidClientAccess` 在**任何查询之前**先跑；不通过直接返回，
 *     一条 DB 查询都不发（测试用 `mockFrom` 未被调用来钉死）。
 *   - 每条查询都 `.eq('client_id', clientId)`，clientId 是守卫验过的那个。
 *   - `.eq('channel', 'email')` —— conversations 是四渠道共用表，不筛渠道会
 *     把私信/外呼/WhatsApp 也带进这个明确写着「邮件」的页面。
 *   - 只 select 邮件收件箱需要的最小列；不取 owner_email / status_note
 *     （FDE 内部字段）、不取 page_id（邮箱地址，内部归属标记）。
 *
 * Responses:
 *   200  { conversations: [...], counts, viewerEmail }
 *   401  not authenticated
 *   403  not a member of this client (or self_serve 无权)
 *   500  query failed
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveStageAnalysis, type StageAnalysis } from '@/lib/business-inbox/stage-analysis'

interface RouteParams {
  params: { id: string }
}

interface ConversationRow {
  id: string
  subject: string | null
  participant_name: string | null
  message_count: number | null
  last_message_at: string | null
  last_message_from: 'customer' | 'page' | null
  contact_id: string | null
}

export interface InboxConversation {
  id: string
  subject: string | null
  participantName: string | null
  messageCount: number
  lastMessageAt: string | null
  /** true = 最后一封是客人发的，还等我们回。 */
  awaitingReply: boolean
  /** 已存的 CRM 阶段分析；null = 暂无分析（认不出人 / 阶段还没填）。 */
  analysis: StageAnalysis | null
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const clientId = params.id

  // 鉴权在最前面：不通过就返回，下面一条查询都不会发。
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select(
      'id, subject, participant_name, message_count, last_message_at, last_message_from, contact_id',
    )
    .eq('client_id', clientId)
    .eq('channel', 'email')
    .order('last_message_at', { ascending: false })
    .limit(200)

  if (error) {
    return NextResponse.json({ error: 'Failed to load inbox' }, { status: 500 })
  }

  const rows = (data ?? []) as unknown as ConversationRow[]

  const contactIds = rows
    .map((r) => r.contact_id)
    .filter((v): v is string => typeof v === 'string')
  const analysisByContact = await resolveStageAnalysis(clientId, contactIds)

  const conversations: InboxConversation[] = rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    participantName: r.participant_name,
    messageCount: r.message_count ?? 0,
    lastMessageAt: r.last_message_at,
    awaitingReply: r.last_message_from === 'customer',
    analysis: (r.contact_id ? analysisByContact.get(r.contact_id) : null) ?? null,
  }))

  return NextResponse.json({
    conversations,
    counts: {
      total: conversations.length,
      awaitingReply: conversations.filter((c) => c.awaitingReply).length,
    },
    viewerEmail: access.user.email ?? null,
  })
}
