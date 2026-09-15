/**
 * POST /api/clients/[id]/messenger/conversations/[conversationId]/reply
 *
 * Two request shapes, told apart by whether `draft_id` is present:
 *
 * 1. Free-text send — `{ body: string, usedAiDraft?: boolean }`. Send a
 *    Messenger reply as the client's Page. A human must have pressed send —
 *    nothing here is triggered by the AI. Every attempt is written to
 *    conversation_outbound_log with the signed-in email attached.
 *
 * 2. Draft decision (Issue #1586, F3 `conversation.approval.emit`) —
 *    `{ draft_id: string, action: 'approve' | 'edit_and_approve' | 'reject',
 *    edited_body?: string }`. This is the portal's "批准发送 / 改后发送 /
 *    拒绝并接管" three-button decision on an AI-drafted reply
 *    (`conversation_reply_drafts`, Issue #1574) that already passed the
 *    Verifier (Issue #1579) and is waiting on a human. `approve` /
 *    `edit_and_approve` mark the draft `verifier_status='approved'` and emit
 *    `conversation/reply.approved` so F2's (#1585) `step.waitForEvent` can
 *    proceed to actually send it — this route does NOT send the message
 *    itself. `reject` only flips the draft to `verifier_status='rejected'`;
 *    it does not notify F2, because rejecting means a human takes over and
 *    replies manually outside this automated path (design doc's three-button
 *    UX: "拒绝并接管").
 *
 * Responses (free-text send):
 *   200  { ok: true, window }
 *   400  empty body
 *   401  not authenticated
 *   403  not a member of this client, or the thread belongs to another client
 *   404  conversation not found
 *   409  Meta's reply window has closed
 *   424  Meta auth not configured for this client
 *   502  Meta rejected the message
 *
 * Responses (draft decision):
 *   200  { ok: true, verifier_status: 'approved' | 'rejected' }
 *   400  missing/invalid action, or edit_and_approve without edited_body
 *   401  not authenticated
 *   403  not a member of this client
 *   404  no such draft for this client + conversation
 *   409  draft is not in 'pending' state (already decided, or blocked by the Verifier)
 *   502  DB update succeeded but notifying F2 failed — draft is rolled back to
 *        'pending' so the human sees an explicit error and can retry, rather
 *        than a draft silently stuck "approved" with nobody ever told to send it
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { sendReply } from '@/lib/messenger/send'
import { supabaseAdmin } from '@/lib/supabase'
import { emitConversationApprovalEvent } from '@/lib/inngest/functions/conversation-approval-emit'

interface RouteParams {
  params: { id: string; conversationId: string }
}

const DRAFT_ACTIONS = ['approve', 'edit_and_approve', 'reject'] as const
type DraftAction = (typeof DRAFT_ACTIONS)[number]

function isDraftAction(value: unknown): value is DraftAction {
  return typeof value === 'string' && (DRAFT_ACTIONS as readonly string[]).includes(value)
}

interface DraftRow {
  id: string
  client_id: string
  conversation_id: string
  verifier_status: string
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const email = access.user.email?.toLowerCase().trim()
  if (!email) {
    // Every outbound message must be attributable to a person; an unattributable
    // send is worse than no send.
    return NextResponse.json({ error: '无法确认发送者身份' }, { status: 403 })
  }

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  if (typeof payload.draft_id === 'string') {
    return handleDraftDecision(params, email, payload.draft_id, payload)
  }

  if (typeof payload.body !== 'string') {
    return NextResponse.json({ error: '回复内容不能为空' }, { status: 400 })
  }

  const result = await sendReply({
    clientId: params.id,
    conversationId: params.conversationId,
    body: payload.body,
    sentByEmail: email,
    usedAiDraft: payload.usedAiDraft === true,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error, reason: result.reason }, { status: result.status })
  }

  return NextResponse.json({ ok: true, window: result.window })
}

async function handleDraftDecision(
  params: RouteParams['params'],
  email: string,
  draftId: string,
  payload: Record<string, unknown>,
): Promise<NextResponse> {
  if (!isDraftAction(payload.action)) {
    return NextResponse.json(
      { error: 'action 必须是 approve / edit_and_approve / reject 之一' },
      { status: 400 },
    )
  }
  const action = payload.action

  const editedBody = action === 'edit_and_approve' ? payload.edited_body : undefined
  if (action === 'edit_and_approve') {
    if (typeof editedBody !== 'string' || editedBody.trim().length === 0) {
      return NextResponse.json({ error: 'edit_and_approve 必须带非空的 edited_body' }, { status: 400 })
    }
  }

  // 双 key 归属校验（IDOR 闸，跟 query_conversation_history/optout.ts 同一条纪律）：
  // draft_id 本身不足以信任——必须同时确认它属于 URL 里的 client 和 conversation，
  // 不能让一个知道别人 draft_id 的人跨客户批准/拒绝一条不属于自己的草稿。
  const { data: draft, error: fetchError } = await supabaseAdmin
    .from('conversation_reply_drafts')
    .select('id, client_id, conversation_id, verifier_status')
    .eq('id', draftId)
    .eq('client_id', params.id)
    .eq('conversation_id', params.conversationId)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json({ error: `查询草稿失败：${fetchError.message}` }, { status: 500 })
  }
  const draftRow = draft as DraftRow | null
  if (!draftRow) {
    return NextResponse.json({ error: '草稿不存在，或不属于这个客户/会话' }, { status: 404 })
  }
  if (draftRow.verifier_status !== 'pending') {
    return NextResponse.json(
      {
        error: `这条草稿当前状态是 "${draftRow.verifier_status}"，不能再批准/拒绝`,
        reason: 'not_pending',
      },
      { status: 409 },
    )
  }

  if (action === 'reject') {
    const { error: updateError } = await supabaseAdmin
      .from('conversation_reply_drafts')
      .update({ verifier_status: 'rejected', decided_at: new Date().toISOString(), decided_by_email: email })
      .eq('id', draftId)
    if (updateError) {
      return NextResponse.json({ error: `拒绝失败：${updateError.message}` }, { status: 500 })
    }
    return NextResponse.json({ ok: true, verifier_status: 'rejected' })
  }

  // approve / edit_and_approve
  const approvePatch: Record<string, unknown> = {
    verifier_status: 'approved',
    decided_at: new Date().toISOString(),
    decided_by_email: email,
  }
  if (action === 'edit_and_approve') {
    approvePatch.draft_body = editedBody
  }

  const { error: approveError } = await supabaseAdmin
    .from('conversation_reply_drafts')
    .update(approvePatch)
    .eq('id', draftId)
  if (approveError) {
    return NextResponse.json({ error: `批准失败：${approveError.message}` }, { status: 500 })
  }

  try {
    await emitConversationApprovalEvent({
      draftId,
      clientId: params.id,
      conversationId: params.conversationId,
      decidedByEmail: email,
    })
  } catch (err) {
    // Fail-closed 补偿：通知 F2 失败就把状态退回 pending，让人看到明确的错误再重试——
    // 不能留一条 DB 里"已批准"但 F2 永远收不到唤醒事件的草稿，那会静默卡到 4 小时
    // 超时，且没人知道发生了什么（跟 src/lib/knowledge/kill-switch.ts 头注释同一条
    // 纪律：失败方向必须是安全的那一边，不是显得"已经成功"的那一边）。
    await supabaseAdmin
      .from('conversation_reply_drafts')
      .update({ verifier_status: 'pending', decided_at: null, decided_by_email: null })
      .eq('id', draftId)
    return NextResponse.json(
      {
        error: `批准已写入数据库，但通知发送流程失败，已回退为待批准状态，请重试：${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true, verifier_status: 'approved' })
}
