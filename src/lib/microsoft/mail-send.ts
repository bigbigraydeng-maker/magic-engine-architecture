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
 * ## 审计走的是 `lib/messenger/send.ts` 同一张表
 *
 * 一开始以为 `conversation_outbound_log` 的 `meta_message_id` /
 * `messaging_type` 两列是照 Meta 的窗口模型开的、邮件用不上，打算跳过这层
 * 审计——2026-09-15 子牙架构复审 PR #1714 指出这个判断没查证：两列在表结构
 * 里就是不限内容的自由文本列，没有 CHECK 约束卡死取值，今天就能直接塞邮件
 * 的记录进去，不需要动表结构。已经改成跟私信同一套「先插一行 pending、
 * 发完/发失败都回填」，`messaging_type` 存字面量 `'email'`——不是 Meta 的
 * 窗口态，只是「这行审计是哪个渠道发的」，跟 `channel` 列语义相同，写重复
 * 是因为这张表目前没有单独的 channel 列，加一列比新增审计表本身还大。
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
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        // 没有这个请求头，这封信从「草稿」变「已发送」时 id 会变——那正是
        // send() 紧接着要做的事。id 一变，下次每小时同步读到的是另一个 id，
        // 会把这封刚发的信当成新信插出重复的一行。跟 mail-graph.ts 用同一个
        // 请求头，两边才认得出是同一封（见那边文件头「4」的说明）。
        Prefer: 'IdType="ImmutableId"',
      },
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

/**
 * 把草稿发出去。成功是 202，没有正文——这一步本身不返回 id，`Prefer` 请求头
 * 加不加不影响这次调用，但留着跟另外两处一致，别让读代码的人以为漏掉了。
 */
async function sendDraft(token: string, draftId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response
  try {
    res = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(draftId)}/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Prefer: 'IdType="ImmutableId"' },
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

  // 发之前先插一行——Graph 调用中途崩溃也要能查出「谁试过发、发了什么」，
  // 跟私信那条路同一张表、同一个原则（见文件头）。
  const { data: audit } = await supabaseAdmin
    .from('conversation_outbound_log')
    .insert({
      conversation_id: convo.id,
      client_id: convo.client_id,
      sent_by_email: input.sentByEmail,
      body,
      used_ai_draft: false,
      messaging_type: 'email',
      status: 'pending',
    })
    .select('id')
    .single()

  const finishAudit = async (patch: Record<string, unknown>) => {
    if (!audit?.id) return
    try {
      await supabaseAdmin.from('conversation_outbound_log').update(patch).eq('id', audit.id)
    } catch (err) {
      console.error('[mail-send] 回填发送审计失败:', audit.id, err)
    }
  }

  const draft = await createReplyDraft(token, parentMessageId, body)
  if (!draft.ok) {
    await finishAudit({ status: 'failed', error_message: draft.error })
    return { ok: false, status: 502, error: `建回复草稿失败: ${draft.error}`, reason: 'graph_failed' }
  }

  const sent = await sendDraft(token, draft.draftId)
  if (!sent.ok) {
    await finishAudit({ status: 'failed', error_message: sent.error })
    return { ok: false, status: 502, error: `发送失败: ${sent.error}`, reason: 'graph_failed' }
  }

  await finishAudit({ status: 'sent', meta_message_id: draft.draftId })

  // 信已经真的发出去了——这之后的写库都是「让页面/CRM当场跟上事实」，
  // 不是「这封信算不算发出去了」的判断。哪一步崩了都不能把 send() 判失败：
  // 那会让人以为没发出去而重发一遍，客人收到两封一样的信。失败只打日志，
  // 亏欠的是「卡片要等下一次每小时同步才更新」，不是「话被重复说一遍」。
  try {
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
  } catch (err) {
    console.error('[mail-send] 信发出去了，但写进时间线失败:', draft.draftId, err)
  }

  try {
    await supabaseAdmin
      .from('conversations')
      .update({ last_message_at: new Date().toISOString(), last_message_from: 'page' })
      .eq('id', convo.id)
  } catch (err) {
    console.error('[mail-send] 信发出去了，但更新会话最后消息时间失败:', convo.id, err)
  }

  if (convo.contact_id) {
    try {
      await writeTouchpoint(convo.client_id, convo.contact_id, draft.draftId, body)
    } catch (err) {
      console.error('[mail-send] 信发出去了，但补触点失败:', convo.contact_id, err)
    }
  }

  return { ok: true, messageId: draft.draftId }
}
