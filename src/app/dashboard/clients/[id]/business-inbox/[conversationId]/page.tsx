'use client'

/**
 * 商务收件箱 —— 单条邮件对话查看视图，只读。
 *
 * 一条线程的每一封信按时间排开（来信靠左、我们发的靠右），配这个人已存的 CRM
 * 阶段分析。**不回信、不问模型、不显示附件**（库里根本不存附件）。
 *
 * 数据来自 `/api/clients/[id]/business-inbox/conversations/[conversationId]/messages`，
 * 那条路由对非法 id / 跨租户 / 非邮件渠道一律返回同一个 404，不暴露存在性。
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { InboxConversationDetail } from '@/app/api/clients/[id]/business-inbox/conversations/[conversationId]/messages/route'

interface DetailResponse extends InboxConversationDetail {
  error?: string
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

export default function BusinessInboxDetailPage() {
  const params = useParams()
  const clientId = params.id as string
  const conversationId = params.conversationId as string

  const [data, setData] = useState<DetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/clients/${clientId}/business-inbox/conversations/${conversationId}/messages`,
      )
      const json = (await res.json()) as DetailResponse
      if (!res.ok) {
        setError(res.status === 404 ? '找不到这条对话。' : (json.error ?? '加载失败'))
        return
      }
      setData(json)
    } catch {
      setError('加载失败，检查网络后再试。')
    } finally {
      setLoading(false)
    }
  }, [clientId, conversationId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
      <header className="mb-5">
        <Link
          href={`/dashboard/clients/${clientId}/business-inbox`}
          className="text-sm text-me-charcoal/40 hover:text-me-charcoal"
        >
          ← 返回收件箱
        </Link>
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

      {!loading && !error && data && (
        <>
          <div className="rounded-xl border border-black/10 bg-white p-4">
            <p className="text-sm font-black text-me-charcoal">
              {data.conversation.participantName ?? '（未知发件人）'}
            </p>
            <p className="mt-0.5 text-sm text-me-charcoal/70">
              {data.conversation.subject ?? '（无主题）'}
            </p>
            <p className="mt-2 text-[11px] font-semibold">
              {data.analysis ? (
                <span className="text-me-charcoal/70">
                  跟进到：{data.analysis.stageLabel}
                  {data.analysis.stageUpdatedAt && (
                    <span className="text-me-charcoal/40">
                      {' '}
                      · {formatWhen(data.analysis.stageUpdatedAt)}
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-me-charcoal/35">暂无分析</span>
              )}
            </p>
          </div>

          <div className="mt-4 space-y-3">
            {data.messages.length === 0 && (
              <p className="py-10 text-center text-sm text-me-charcoal/40">这条对话没有可显示的邮件。</p>
            )}
            {data.messages.map((m, i) => {
              const inbound = m.direction === 'inbound'
              return (
                <div
                  key={i}
                  className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-xl border p-3 ${
                      inbound
                        ? 'border-black/10 bg-white'
                        : 'border-me-charcoal/15 bg-me-ivory'
                    }`}
                  >
                    <p className="text-[11px] font-black text-me-charcoal/45">
                      {inbound ? (m.senderName ?? '客人') : '我们'} · {formatWhen(m.sentAt)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-me-charcoal/85">
                      {m.body ?? '（无正文预览）'}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>

          <p className="mt-8 text-center text-[11px] text-me-charcoal/25">
            只显示邮件正文预览，不含附件 · 要回信请到邮箱里回
          </p>
        </>
      )}
    </div>
  )
}
