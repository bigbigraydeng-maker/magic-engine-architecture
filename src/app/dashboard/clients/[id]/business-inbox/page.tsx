'use client'

/**
 * 商务收件箱 —— 客户自己的 Outlook 邮件对话，只读。
 *
 * 这一页只做三件事：把已同步的邮件对话列出来、标出哪些还等我们回、把 CRM 早
 * 就判好的「跟进到哪一步」显示出来。**不发信、不回信、不问模型** —— 要回信仍然
 * 去邮箱里回。没有分析就老实写「暂无分析」，不编。
 *
 * 数据全部来自 `/api/clients/[id]/business-inbox/conversations`，租户隔离在那条
 * 路由里收口（requirePaidClientAccess + client_id + channel='email'）。
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { InboxConversation } from '@/app/api/clients/[id]/business-inbox/conversations/route'

interface InboxResponse {
  conversations: InboxConversation[]
  counts: { total: number; awaitingReply: number }
  viewerEmail: string | null
  error?: string
}

function Stat({ value, label, strong }: { value: number; label: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white px-3 py-3 text-center">
      <p
        className={`text-2xl font-black ${strong && value > 0 ? 'text-[#C2453A]' : 'text-me-charcoal'}`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] font-semibold text-me-charcoal/45">{label}</p>
    </div>
  )
}

function formatWhen(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Pacific/Auckland',
  })
}

function ConversationRow({
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-me-charcoal">
            {c.participantName ?? '（未知发件人）'}
          </p>
          <p className="mt-0.5 truncate text-sm text-me-charcoal/70">
            {c.subject ?? '（无主题）'}
          </p>
        </div>
        {c.awaitingReply && (
          <span className="shrink-0 rounded-full bg-[#C2453A]/10 px-2.5 py-1 text-[11px] font-black text-[#C2453A]">
            等我们回
          </span>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-[11px] font-semibold text-me-charcoal/45">
        <span>
          {c.analysis ? (
            <span className="text-me-charcoal/70">跟进到：{c.analysis.stageLabel}</span>
          ) : (
            <span className="text-me-charcoal/35">暂无分析</span>
          )}
        </span>
        <span>
          {c.messageCount} 封 · {formatWhen(c.lastMessageAt)}
        </span>
      </div>
    </Link>
  )
}

export default function BusinessInboxPage() {
  const params = useParams()
  const clientId = params.id as string

  const [data, setData] = useState<InboxResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/business-inbox/conversations`)
      const json = (await res.json()) as InboxResponse
      if (!res.ok) {
        setError(json.error ?? '加载失败')
        return
      }
      setData(json)
    } catch {
      setError('加载失败，检查网络后再试。')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
      <header className="mb-5">
        <Link
          href={`/dashboard/clients/${clientId}`}
          className="text-sm text-me-charcoal/40 hover:text-me-charcoal"
        >
          ← 返回客户
        </Link>
        <h1 className="mt-2 text-2xl font-black text-me-charcoal">商务收件箱</h1>
        <p className="mt-1 text-sm leading-relaxed text-me-charcoal/45">
          已连接的 Outlook 邮箱每小时自动同步 · 这里只看，不回信。
          <span className="font-semibold text-me-charcoal/60">要回信仍然去邮箱里回。</span>
        </p>
      </header>

      {loading && <p className="py-16 text-center text-sm text-me-charcoal/40">加载中…</p>}

      {error && (
        <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
          <p className="text-sm font-semibold text-[#C2453A]">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 text-sm font-black text-me-charcoal underline"
          >
            重试
          </button>
        </div>
      )}

      {!loading && !error && data && data.counts.total === 0 && (
        <div className="rounded-xl border border-black/10 bg-white p-8 text-center">
          <p className="text-sm text-me-charcoal/60">还没有同步到任何邮件对话。</p>
          <p className="mt-2 text-xs leading-relaxed text-me-charcoal/40">
            系统每小时自动拉一次。如果这里一直是空的，说明邮箱还没接上 —— 找 Magic Lab 团队看一眼。
          </p>
        </div>
      )}

      {!loading && !error && data && data.counts.total > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat value={data.counts.awaitingReply} label="等我们回" strong />
            <Stat value={data.counts.total} label="全部对话" />
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => void load()}
              className="px-2 text-xs font-semibold text-me-charcoal/40"
            >
              刷新
            </button>
          </div>

          <div className="mt-2 space-y-3">
            {data.conversations.map((c) => (
              <ConversationRow key={c.id} clientId={clientId} conversation={c} />
            ))}
          </div>

          <p className="mt-8 text-center text-[11px] text-me-charcoal/25">
            阶段由 AI 读对话判定，可能会漏或读错 · 拿不准就点开看完整邮件自己核一遍
          </p>
        </>
      )}
    </div>
  )
}
