'use client'

/**
 * 商务收件箱 —— 客户自己的 Outlook 邮件对话，只读。
 *
 * 这一页只做两件事：把已同步的邮件对话按最新在前列出来、把 CRM 早就判好的
 * 「跟进到哪一步」显示出来。**不发信、不回信、不问模型** —— 要回信仍然去邮箱里回。
 * 显示的只是同步存下的邮件正文摘要，不是完整邮件；没有分析就老实写「暂无分析」。
 *
 * 对话可能超过一页（CTS 已经超 200 条），用「往下再看一页」翻，顶部显示**真实
 * 总数**。这不是完整邮件客户端：没有搜索 / 文件夹 / 标签。
 *
 * 取数逻辑收在 useInbox，展示件收在 _components/bits —— 页面主函数保持精简。
 * 租户隔离在 /api/clients/[id]/business-inbox/conversations 路由里收口。
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type {
  InboxConversation,
  InboxPage,
} from '@/app/api/clients/[id]/business-inbox/conversations/route'
import { ConversationRow, EmptyInbox, ErrorBox } from './_components/bits'

interface InboxResponse {
  conversations: InboxConversation[]
  page: InboxPage
  viewerEmail: string | null
  error?: string
}

async function fetchInboxPage(clientId: string, offset: number): Promise<InboxResponse> {
  const res = await fetch(`/api/clients/${clientId}/business-inbox/conversations?offset=${offset}`)
  const json = (await res.json()) as InboxResponse
  if (!res.ok) throw new Error(json.error ?? '加载失败')
  return json
}

function useInbox(clientId: string) {
  const [conversations, setConversations] = useState<InboxConversation[]>([])
  const [page, setPage] = useState<InboxPage | null>(null)
  const [viewerEmail, setViewerEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const json = await fetchInboxPage(clientId, 0)
      setConversations(json.conversations)
      setPage(json.page)
      setViewerEmail(json.viewerEmail)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败，检查网络后再试。')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  const loadMore = useCallback(async () => {
    if (!page || !page.hasMore || loadingMore) return
    setLoadingMore(true)
    setError(null)
    try {
      const json = await fetchInboxPage(clientId, page.offset + page.pageSize)
      setConversations((prev) => [...prev, ...json.conversations])
      setPage(json.page)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败，检查网络后再试。')
    } finally {
      setLoadingMore(false)
    }
  }, [clientId, page, loadingMore])

  useEffect(() => {
    void load()
  }, [load])

  return { conversations, page, viewerEmail, loading, loadingMore, error, load, loadMore }
}

function InboxList({
  clientId,
  conversations,
  page,
  loadingMore,
  onRefresh,
  onLoadMore,
}: {
  clientId: string
  conversations: InboxConversation[]
  page: InboxPage
  loadingMore: boolean
  onRefresh: () => void
  onLoadMore: () => void
}) {
  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-xs font-black text-me-charcoal/60">
          共 {page.total} 条 · 已显示 {conversations.length}
        </p>
        <button
          type="button"
          onClick={onRefresh}
          className="px-2 text-xs font-semibold text-me-charcoal/40"
        >
          刷新
        </button>
      </div>

      <div className="mt-3 space-y-3">
        {conversations.map((c) => (
          <ConversationRow key={c.id} clientId={clientId} conversation={c} />
        ))}
      </div>

      {page.hasMore && (
        <div className="mt-5 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="rounded-full border border-me-stone px-5 py-2 text-xs font-black text-me-charcoal/70 disabled:opacity-50"
          >
            {loadingMore ? '加载中…' : '往下再看一页'}
          </button>
        </div>
      )}

      <p className="mt-8 text-center text-[11px] text-me-charcoal/25">
        显示的是同步存下的邮件正文摘要（不是完整邮件）· 阶段由 AI 判定可能有误 · 完整邮件请到原邮箱查看
      </p>
    </>
  )
}

export default function BusinessInboxPage() {
  const params = useParams()
  const clientId = params.id as string
  const { conversations, page, viewerEmail, loading, loadingMore, error, load, loadMore } =
    useInbox(clientId)

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
        {viewerEmail && (
          <p className="mt-1 text-[11px] text-me-charcoal/30">当前登录：{viewerEmail}</p>
        )}
      </header>

      {loading && <p className="py-16 text-center text-sm text-me-charcoal/40">加载中…</p>}

      {error && !loading && <ErrorBox message={error} onRetry={() => void load()} />}

      {!loading && !error && page && page.total === 0 && <EmptyInbox />}

      {!loading && page && page.total > 0 && (
        <InboxList
          clientId={clientId}
          conversations={conversations}
          page={page}
          loadingMore={loadingMore}
          onRefresh={() => void load()}
          onLoadMore={() => void loadMore()}
        />
      )}
    </div>
  )
}
