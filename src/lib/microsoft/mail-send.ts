/**
 * 从 CRM 里给客人回一封邮件（Microsoft Graph）——真人按发送才会调这个函数。
 *
 * 读邮件（mail-graph.ts / mail-ingest.ts）已经在跑，一直漏的是这一半：授权时
 * `Mail.Send` 权限早就要过（见 mail-oauth.ts），却从没被用起来。
 *
 * ## 用 createReply + send 两步，不用一步到位的 `/reply`
 *
 * Graph 的 `/messages/{id}/reply` 更省一次调用，但它成功时只回 202、拿不到
 * 新邮件的 id。**拿不到 id 就没法跟一小时后那次同步对上号**——`mail-ingest`
 * 按 Graph 给的消息 id 去重（`conversation_messages` 的 `onConflict:
 * 'conversation_id,message_id'`），我们这边如果编一个假 id，下一次同步会把
 * 这封刚发的信当成一封"新信"，同一句话在时间线上出现两次。
 *
 * `createReply` 先建一份草稿、把真实 id 亮出来，再 `send` 把那份草稿发出去
 * ——这个 id 就是这封信在「已发送」文件夹里最终的样子，跟下一次同步读到的
 * 是同一封，天然不会重复。
 *
 * ## 跟 `lib/messenger/send.ts` 的差别（刻意，不是漏做）
 *
 * 那边多一层「先插一行 pending 审计、发完再回填」，防的是 Graph 调用中途
 * 崩溃时连"谁试过发"都查不到。这一版先不做——`conversation_outbound_log`
 * 表目前的列（`meta_message_id` / `messaging_type` 取值 standard|human_agent）
 * 是照 Meta 的窗口模型开的，邮件没有这个窗口概念，硬套等于把语义搞混。
 * 要补审计需要一次表结构改动，属于另一件事，不在今天的范围里。
 * 消息本身、触点都会照写，只是少了「发送尝试」这一层记录。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { fetchConnectionRow, getValidTokenForConnection } from '@/lib/platform-oauth/token-manager'
import { MICROSOFT_MAIL_PROVIDER } from '@/lib/microsoft/mail-oauth'

const GRAPH = 'https://graph.microsoft.com/v1.0'

export interface SendMailReplyInput {
  clientId: string
  conversationId: string
  body: string
  sentByEmail: string
}

export type SendMailReplyResult =
  | { ok: true; messageId: string }
  | {
      ok: false
      status: 400 | 403 | 404 | 409 | 424 | 502
      error: string
      reason: 'empty_body' | 'not_found' | 'wrong_client' | 'wrong_channel' | 'no_thread' | 'no_token' | 'graph_failed'
    }

interface ConversationRow {
  id: string
  client_id: string
  channel: string
  contact_id: string | null
}

/** 这条线程里最新的一封信——不分方向，回信就是往它上面接一句话。 */
async function latestMessageId(conversationId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('conversation_messages')
    .select('message_id')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.message_id as string | undefined) ?? null
}

/** 建一份回复草稿，回真实的消息 id——发之前就知道，才能跟下次同步对上号。 */
async function createReplyDraft(
  token: string,
  parentMessageId: string,
  comment: string,
): Promise<{ ok: true; draftId: string } | { ok: false; error: string }> {
  let res: Response
  try {
    res = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(parentMessageId)}/createReply`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment }),
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}` }
  }
  const data = (await res.json()) as { id?: string }
  if (!data.id) return { ok: false, error: '建草稿成功但没拿到消息 id' }
  return { ok: true, draftId: data.id }
}

/** 把草稿发出去。成功是 202，没有正文。 */
async function sendDraft(token: string, draftId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response
  try {
    res = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(draftId)}/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  if (res.status === 202) return { ok: true }
  const text = await res.text().catch(() => '')
  return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}` }
}

/** 补一笔「我们回过他了」的触点——跟 mail-ingest 用同一个幂等键，下次同步不会重复。 */
async function writeTouchpoint(clientId: string, contactId: string, messageId: string, body: string): Promise<void> {
  await supabaseAdmin.from('contact_touchpoints').upsert(
    {
      client_id: clientId,
      contact_id: contactId,
      channel: 'email',
      direction: 'outbound',
      occurred_at: new Date().toISOString(),
      summary: body.slice(0, 120),
      raw: body,
      metadata: { automated: false, logged_by: null },
      source: 'microsoft_mail',
      source_ref: messageId,
    },
    { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true },
  )
}

export async function sendMailReply(input: SendMailReplyInput): Promise<SendMailReplyResult> {
  const body = input.body.trim()
  if (!body) {
    return { ok: false, status: 400, error: '回复内容不能为空', reason: 'empty_body' }
  }

  const { data: convo } = await supabaseAdmin
    .from('conversations')
    .select('id, client_id, channel, contact_id')
    .eq('id', input.conversationId)
    .maybeSingle<ConversationRow>()

  if (!convo) {
    return { ok: false, status: 404, error: '对话不存在', reason: 'not_found' }
  }
  if (convo.client_id !== input.clientId) {
    return { ok: false, status: 403, error: 'Forbidden', reason: 'wrong_client' }
  }
  // conversations 是四个渠道共用的表——走到这里的必须是邮件，否则会拿一条
  // 私信线程去调 Graph 的接口，而且会误判成「没有可回复的邮件」。
  if (convo.channel !== 'email') {
    return { ok: false, status: 409, error: '这条不是邮件，不能在这里回', reason: 'wrong_channel' }
  }

  const parentMessageId = await latestMessageId(convo.id)
  if (!parentMessageId) {
    return { ok: false, status: 409, error: '这条对话没有可回复的邮件', reason: 'no_thread' }
  }

  let connection: Awaited<ReturnType<typeof fetchConnectionRow>>
  try {
    connection = await fetchConnectionRow(convo.client_id, MICROSOFT_MAIL_PROVIDER)
  } catch {
    return { ok: false, status: 424, error: '邮箱授权掉线了，请找 Magic Lab 团队重连', reason: 'no_token' }
  }

  let token: string
  try {
    token = await getValidTokenForConnection(connection.id)
  } catch {
    return { ok: false, status: 424, error: '邮箱授权掉线了，请找 Magic Lab 团队重连', reason: 'no_token' }
  }

  const draft = await createReplyDraft(token, parentMessageId, body)
  if (!draft.ok) {
    return { ok: false, status: 502, error: `建回复草稿失败: ${draft.error}`, reason: 'graph_failed' }
  }

  const sent = await sendDraft(token, draft.draftId)
  if (!sent.ok) {
    return { ok: false, status: 502, error: `发送失败: ${sent.error}`, reason: 'graph_failed' }
  }

  // 立刻把这条消息写进线程，卡片当场更新，不用等下一次每小时同步。
  // message_id 用 createReply 给的真实 id——下次同步读到同一封信时，
  // conversation_messages 的 (conversation_id, message_id) 唯一键会认出
  // 这是同一封,不会插出第二行。
  await supabaseAdmin.from('conversation_messages').insert({
    conversation_id: convo.id,
    message_id: draft.draftId,
    direction: 'outbound',
    sender_name: input.sentByEmail,
    body,
    sent_at: new Date().toISOString(),
  })

  await supabaseAdmin
    .from('conversations')
    .update({ last_message_at: new Date().toISOString(), last_message_from: 'page' })
    .eq('id', convo.id)

  if (convo.contact_id) {
    await writeTouchpoint(convo.client_id, convo.contact_id, draft.draftId, body)
  }

  return { ok: true, messageId: draft.draftId }
}
