/**
 * GET /api/clients/[id]/business-inbox/conversations
 *
 * 客户自己的商务收件箱列表：这个客户已同步进来的 **Outlook 邮件**对话，
 * 一条对话一行，配上「CRM 判到哪一步」的已存分析。
 *
 * 全程只读：不发信、不问模型、不碰 provider。分析读自 `contacts.stage`
 * （由 `src/lib/crm/stage-infer.ts` 早就算好落库的），这里只取出来显示。
 *
 * 分页（Codex PATCH1 P2）：CTS 的邮件对话已经超过 200 条。列表按最新在前分页，
 * 附**真实总数**和 `hasMore` —— 不截断在 200、也不报一个假的 total。这不是完整
 * 邮件客户端的目录：没有搜索 / 文件夹 / 标签，只有「往下再看一页」。
 *
 * 隔离（Risk A）：
 *   - `requirePaidClientAccess` 在**任何查询之前**先跑；不通过直接返回，
 *     一条 DB 查询都不发（测试用 `mockFrom` 未被调用来钉死）。
 *   - 每条查询都 `.eq('client_id', clientId)`，clientId 是守卫验过的那个。
 *   - `.eq('channel', 'email')` —— conversations 是四渠道共用表，不筛渠道会
 *     把私信/外呼/WhatsApp 也带进这个明确写着「邮件」的页面。
 *   - 只 select 邮件收件箱需要的最小列；不取 owner_email / status_note
 *     （FDE 内部字段）、不取 page_id（邮箱地址，内部归属标记）、
 *     不取 last_message_from（见下：不再据它推「等我们回」）。
 *
 * Responses:
 *   200  { conversations: [...], page, viewerEmail }
 *   401  not authenticated
 *   403  not a member of this client (or self_serve 无权)
 *   500  query failed (含 stage 分析取数失败 —— 绝不静默降级成「暂无分析」)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import {
  resolveStageAnalysis,
  StageAnalysisError,
  type StageAnalysis,
} from '@/lib/business-inbox/stage-analysis'

interface RouteParams {
  params: { id: string }
}

/** 一页多少条。窄分页，不是无限滚动框架。 */
const PAGE_SIZE = 50

interface ConversationRow {
  id: string
  subject: string | null
  participant_name: string | null
  message_count: number | null
  last_message_at: string | null
  contact_id: string | null
}

export interface InboxConversation {
  id: string
  subject: string | null
  participantName: string | null
  messageCount: number
  lastMessageAt: string | null
  /** 已存的 CRM 阶段分析；null = 暂无分析（认不出人 / 阶段还没填，且**查询成功**）。 */
  analysis: StageAnalysis | null
}

export interface InboxPage {
  offset: number
  pageSize: number
  /** 这个客户全部邮件对话的**真实**总数（不是本页条数）。 */
  total: number
  /** 还有更没显示的更旧对话。 */
  hasMore: boolean
}

/** 解析 offset：只认非负整数，其它一律从头开始 —— 不把脏输入带进 range。 */
function parseOffset(req: NextRequest): number {
  const raw = req.nextUrl.searchParams.get('offset')
  if (!raw) return 0
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : 0
}

export async function GET(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const clientId = params.id

  // 鉴权在最前面：不通过就返回，下面一条查询都不会发。
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const offset = parseOffset(req)

  // 真实总数：单独一条 count 查询，同样按 client_id + email 收口。
  const { count, error: countErr } = await supabaseAdmin
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('channel', 'email')

  if (countErr) {
    return NextResponse.json({ error: 'Failed to load inbox' }, { status: 500 })
  }

  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('id, subject, participant_name, message_count, last_message_at, contact_id')
    .eq('client_id', clientId)
    .eq('channel', 'email')
    .order('last_message_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (error) {
    return NextResponse.json({ error: 'Failed to load inbox' }, { status: 500 })
  }

  const rows = (data ?? []) as unknown as ConversationRow[]

  const contactIds = rows
    .map((r) => r.contact_id)
    .filter((v): v is string => typeof v === 'string')

  // stage 分析取数失败要变成 500，不能静默降级成「暂无分析」（骗人）。
  let analysisByContact
  try {
    analysisByContact = await resolveStageAnalysis(clientId, contactIds)
  } catch (err) {
    if (err instanceof StageAnalysisError) {
      return NextResponse.json({ error: 'Failed to load analysis' }, { status: 500 })
    }
    throw err
  }

  const conversations: InboxConversation[] = rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    participantName: r.participant_name,
    messageCount: r.message_count ?? 0,
    lastMessageAt: r.last_message_at,
    analysis: (r.contact_id ? analysisByContact.get(r.contact_id) : null) ?? null,
  }))

  const total = count ?? 0
  const page: InboxPage = {
    offset,
    pageSize: PAGE_SIZE,
    total,
    hasMore: offset + rows.length < total,
  }

  return NextResponse.json({
    conversations,
    page,
    viewerEmail: access.user.email ?? null,
  })
}
