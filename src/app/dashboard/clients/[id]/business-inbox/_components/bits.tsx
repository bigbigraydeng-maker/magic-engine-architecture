'use client'

/**
 * 商务收件箱共用的小展示件 —— 从列表页/详情页里抽出来，让页面主函数保持精简
 * （仓库 <50 行/函数）。全部是纯展示，不含取数逻辑，照 messenger/_components/bits 的做法。
 */

import Link from 'next/link'
import { formatWhen } from '@/lib/business-inbox/format'
import type { InboxConversation } from '@/app/api/clients/[id]/business-inbox/conversations/route'
import type {
  InboxMessage,
  InboxConversationDetail,
} from '@/app/api/clients/[id]/business-inbox/conversations/[conversationId]/messages/route'
import type { StageAnalysis } from '@/lib/business-inbox/stage-analysis'

/** 出错块 + 重试按钮。列表页、详情页共用。 */
export function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
      <p className="text-sm font-semibold text-[#C2453A]">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 text-sm font-black text-me-charcoal underline"
      >
        重试
      </button>
    </div>
  )
}

/** 已存 CRM 阶段一行；没有分析就如实写「暂无分析」。 */
export function AnalysisLine({
  analysis,
  withTime = false,
}: {
  analysis: StageAnalysis | null
  withTime?: boolean
}) {
  if (!analysis) return <span className="text-me-charcoal/35">暂无分析</span>
  return (
    <span className="text-me-charcoal/70">
      跟进到：{analysis.stageLabel}
      {withTime && analysis.stageUpdatedAt && (
        <span className="text-me-charcoal/40"> · {formatWhen(analysis.stageUpdatedAt)}</span>
      )}
    </span>
  )
}

/** 列表里的一条对话卡，点进详情。 */
export function ConversationRow({
  clientId,
  conversation,
}: {
  clientId: string
  conversation: InboxConversation
}) {
  const c = conversation
  return (
    <Link
      href={`/dashboard/clients/${clientId}/business-inbox/${c.id}`}
      className="block rounded-xl border border-black/10 bg-white p-4 transition hover:border-me-charcoal/30"
    >
      <p className="truncate text-sm font-black text-me-charcoal">
        {c.participantName ?? '（未知发件人）'}
      </p>
      <p className="mt-0.5 truncate text-sm text-me-charcoal/70">{c.subject ?? '（无主题）'}</p>
      <div className="mt-3 flex items-center justify-between gap-2 text-[11px] font-semibold text-me-charcoal/45">
        <AnalysisLine analysis={c.analysis} />
        <span>
          {c.messageCount} 封 · {formatWhen(c.lastMessageAt)}
        </span>
      </div>
    </Link>
  )
}

/** 列表空态：还没同步到任何邮件。 */
export function EmptyInbox() {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-8 text-center">
      <p className="text-sm text-me-charcoal/60">还没有同步到任何邮件对话。</p>
      <p className="mt-2 text-xs leading-relaxed text-me-charcoal/40">
        系统每小时自动拉一次。如果这里一直是空的，说明邮箱还没接上 —— 找 Magic Engine 团队看一眼。
      </p>
    </div>
  )
}

/** 详情顶部：发件人 + 主题 + 已存阶段。 */
function ConversationHeader({ data }: { data: InboxConversationDetail }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-4">
      <p className="text-sm font-black text-me-charcoal">
        {data.conversation.participantName ?? '（未知发件人）'}
      </p>
      <p className="mt-0.5 text-sm text-me-charcoal/70">
        {data.conversation.subject ?? '（无主题）'}
      </p>
      <p className="mt-2 text-[11px] font-semibold">
        <AnalysisLine analysis={data.analysis} withTime />
      </p>
    </div>
  )
}

/** 详情已加载正文：头部 + 截断提示 + 逐封信 + 底部说明（只读，纯展示）。 */
export function ConversationThread({ data }: { data: InboxConversationDetail }) {
  return (
    <>
      <ConversationHeader data={data} />

      {data.olderTruncated && (
        <p className="mt-4 rounded-lg border border-me-stone bg-me-ivory px-3 py-2 text-center text-[11px] font-semibold text-me-charcoal/45">
          这条线程太长，只显示最新的一批邮件 · 更早的请到原邮箱看
        </p>
      )}

      <div className="mt-4 space-y-3">
        {data.messages.length === 0 && (
          <p className="py-10 text-center text-sm text-me-charcoal/40">这条对话没有可显示的邮件。</p>
        )}
        {data.messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}
      </div>

      <p className="mt-8 text-center text-[11px] text-me-charcoal/25">
        只显示同步存下的邮件正文摘要（不是完整邮件），完整内容和附件请到原邮箱查看 · 要回信也请到邮箱里回
      </p>
    </>
  )
}

/** 详情里的一封信气泡。body 只是同步存的正文摘要，不是完整邮件。 */
export function MessageBubble({ message }: { message: InboxMessage }) {
  const inbound = message.direction === 'inbound'
  return (
    <div className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[85%] rounded-xl border p-3 ${
          inbound ? 'border-black/10 bg-white' : 'border-me-charcoal/15 bg-me-ivory'
        }`}
      >
        <p className="text-[11px] font-black text-me-charcoal/45">
          {inbound ? (message.senderName ?? '客人') : '我们'} · {formatWhen(message.sentAt)}
        </p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-me-charcoal/85">
          {message.body ?? '（无正文摘要）'}
        </p>
      </div>
    </div>
  )
}
