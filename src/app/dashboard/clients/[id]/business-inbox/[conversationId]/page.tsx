'use client'

/**
 * 商务收件箱 —— 单条邮件对话查看视图，只读。
 *
 * 一条线程的每一封信按时间排开（来信靠左、我们发的靠右），配这个人已存的 CRM
 * 阶段分析。**不回信、不问模型、不显示附件**。每封信显示的是同步存下的正文摘要，
 * 不是完整邮件 —— 完整内容和附件请到原邮箱看。
 *
 * 取数收在 useConversationDetail，展示件收在 _components/bits。数据来自
 * `/api/clients/[id]/business-inbox/conversations/[conversationId]/messages`，
 * 那条路由对非法 id / 跨租户 / 非邮件渠道一律返回同一个 404，不暴露存在性。
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { InboxConversationDetail } from '@/app/api/clients/[id]/business-inbox/conversations/[conversationId]/messages/route'
import { isPaidOnly, PaidOnlyError } from '@/lib/auth/paid-only-handler'
import { ConversationThread, ErrorBox } from '../_components/bits'

/** paid_only 时页面上给的明确中文提示（与列表页一致）。 */
const PAID_MESSAGE = '商务收件箱是付费功能 · 请联系 Magic Engine 开通后查看。'

interface DetailResponse extends InboxConversationDetail {
  error?: string
}

async function fetchDetail(clientId: string, conversationId: string): Promise<DetailResponse> {
  const res = await fetch(
    `/api/clients/${clientId}/business-inbox/conversations/${conversationId}/messages`,
  )
  // self_serve → 403 paid_only。与列表页同一契约：不靠弹窗（这些路由无监听器），
  // 直接在页面上给明确付费提示（见 catch）。
  if (await isPaidOnly(res)) throw new PaidOnlyError('商务收件箱')
  const json = (await res.json()) as DetailResponse
  if (!res.ok) {
    throw new Error(res.status === 404 ? '找不到这条对话。' : (json.error ?? '加载失败'))
  }
  return json
}

function useConversationDetail(clientId: string, conversationId: string) {
  const [data, setData] = useState<DetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await fetchDetail(clientId, conversationId))
    } catch (e) {
      // paid_only：页面上给明确付费提示（不弹窗——这些路由没有弹窗监听器）。
      if (e instanceof PaidOnlyError) { setError(PAID_MESSAGE); return }
      setError(e instanceof Error ? e.message : '加载失败，检查网络后再试。')
    } finally {
      setLoading(false)
    }
  }, [clientId, conversationId])

  useEffect(() => {
    void load()
  }, [load])

  return { data, loading, error, load }
}

export default function BusinessInboxDetailPage() {
  const params = useParams()
  const clientId = params.id as string
  const conversationId = params.conversationId as string
  const { data, loading, error, load } = useConversationDetail(clientId, conversationId)

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

      {error && !loading && <ErrorBox message={error} onRetry={() => void load()} />}

      {!loading && !error && data && <ConversationThread data={data} />}
    </div>
  )
}
