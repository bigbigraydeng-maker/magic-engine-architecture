/**
 * F3 · `conversation.approval.emit`（Issue #1586，design doc"纯中继，不变"）。
 *
 * 🔴 这不是一个被 Inngest 触发的函数——跟这个目录里其它文件（`webIntelligenceCapture`
 * 之类，在 `index.ts` 里注册进 `cloudFunctions`）不一样，它没有自己的事件订阅。它是
 * 门户"批准"/"改后发送"按钮点击那一刻，由 HTTP 路由（
 * `src/app/api/clients/[id]/messenger/conversations/[conversationId]/reply/route.ts`）
 * 同步调用的一个薄封装：把"人工批准了这条草稿"这件事翻译成 F2
 * （`conversation.inbound.draft`，issue #1585）的
 * `step.waitForEvent('conversation/reply.approved', { if: 'async.data.draft_id == "${draftId}"' })`
 * 认识的事件形状。放在 `inngest/functions/` 目录只是延续 design doc 的 F1-F4 编号
 * 习惯，方便以后读代码的人按"F几"对上号，不代表它遵循这个目录里其它文件的
 * "被触发"结构。
 *
 * 发送用的是 `sendInngestEvent`（`src/lib/workflows/inngest-event.ts`）而不是
 * `src/lib/inngest/client.ts` 的云端客户端——跟已经合并的 Messenger webhook
 * （issue #1640）emit `conversation/message.received` 用的是同一条发送路径，保持
 * 这整条 `conversation/*` 事件族的发送方式一致。Inngest 按事件名 fan-out，不按
 * 发送方用的是哪个 SDK 实例，所以这个选择不影响 F2 将来注册在云端还是本机 worker。
 *
 * "拒绝并接管"不经过这里——那条路径只更新 `conversation_reply_drafts.verifier_status`
 * 为 `'rejected'`，不需要唤醒 F2（见 reply route 的拒绝分支注释）。
 */

import { sendInngestEvent } from '@/lib/workflows/inngest-event'

export const CONVERSATION_REPLY_APPROVED_EVENT = 'conversation/reply.approved'

export interface EmitConversationApprovalEventInput {
  draftId: string
  clientId: string
  conversationId: string
  /** 谁点的批准/改后发送——落进事件 data，供 F2 或审计回看时核对操作者。 */
  decidedByEmail: string
}

export interface EmitConversationApprovalEventDeps {
  send?: typeof sendInngestEvent
}

/**
 * 事件 `id` 用 `draftId` 派生（而不是随机 UUID）：Inngest 按事件 `id` 去重
 * （同一个 `id` 重复发送只会被消费一次）。同一条草稿只应该真正触发一次
 * "已批准"事件——如果 FDE 因为网络卡顿重复点击批准按钮、或者调用方对失败做了
 * 重试，这里天然幂等，不会让 F2 收到两次唤醒信号。
 */
function eventIdFor(draftId: string): string {
  return `conversation-approval-emit:${draftId}`
}

export async function emitConversationApprovalEvent(
  input: EmitConversationApprovalEventInput,
  deps: EmitConversationApprovalEventDeps = {},
): Promise<void> {
  const send = deps.send ?? sendInngestEvent
  await send({
    id: eventIdFor(input.draftId),
    name: CONVERSATION_REPLY_APPROVED_EVENT,
    data: {
      draft_id: input.draftId,
      client_id: input.clientId,
      conversation_id: input.conversationId,
      decided_by_email: input.decidedByEmail,
    },
  })
}
