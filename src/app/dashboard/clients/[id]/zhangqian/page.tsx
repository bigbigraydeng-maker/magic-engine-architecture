'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import type {
  ClientDiscoveryRow,
  DiscoveryJob,
  DiscoveredKeyword,
  DiscoveredCompetitor,
  DiscoveredSocial,
  DiscoveredAiQuestion,
  KeywordType,
  CompetitorRelevance,
  AiQuestionCategory,
  SocialPlatform,
} from '@/lib/zhangqian/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const API_KEY = process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? ''

const KEYWORD_TYPE_STYLES: Record<KeywordType, string> = {
  brand:         'bg-purple-100 text-purple-700',
  category:      'bg-blue-100 text-blue-700',
  long_tail:     'bg-green-100 text-green-700',
  local:         'bg-orange-100 text-orange-700',
  transactional: 'bg-red-100 text-red-700',
}

const KEYWORD_TYPE_LABELS: Record<KeywordType, string> = {
  brand:         '品牌',
  category:      '类目',
  long_tail:     '长尾',
  local:         '本地',
  transactional: '购买意图',
}

const RELEVANCE_STYLES: Record<CompetitorRelevance, string> = {
  direct:      'bg-red-100 text-red-700',
  adjacent:    'bg-yellow-100 text-yellow-700',
  aspirational: 'bg-blue-100 text-blue-700',
}

const RELEVANCE_LABELS: Record<CompetitorRelevance, string> = {
  direct:      '直接竞品',
  adjacent:    '相邻竞品',
  aspirational: '标杆',
}

const AI_CATEGORY_STYLES: Record<AiQuestionCategory, string> = {
  brand:      'bg-purple-100 text-purple-700',
  category:   'bg-blue-100 text-blue-700',
  comparison: 'bg-amber-100 text-amber-700',
  local:      'bg-orange-100 text-orange-700',
}

const AI_CATEGORY_LABELS: Record<AiQuestionCategory, string> = {
  brand:      '品牌',
  category:   '类目',
  comparison: '对比',
  local:      '本地',
}

const PLATFORM_ICONS: Record<SocialPlatform, string> = {
  instagram:  '📸',
  facebook:   '👤',
  linkedin:   '💼',
  youtube:    '▶️',
  tiktok:     '🎵',
  twitter:    '🐦',
  pinterest:  '📌',
}

// ─── Page state type ──────────────────────────────────────────────────────────

type PageState = 'idle' | 'running' | 'reviewing' | 'confirmed'

// ─── API response shapes ──────────────────────────────────────────────────────

interface LatestResponse {
  success: boolean
  discovery: ClientDiscoveryRow | null
  error?: string
}

interface DiscoverResponse {
  success: boolean
  job_id: string
  error?: string
}

interface StatusResponse {
  success: boolean
  job: DiscoveryJob
  error?: string
}

interface ConfirmResponse {
  success: boolean
  error?: string
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  )
}

function CardShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  )
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-yellow-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
    </div>
  )
}

// ─── DispatchPanel ────────────────────────────────────────────────────────────

function DispatchPanel({
  onDispatch,
  isDispatching,
  hasExisting,
}: {
  onDispatch: () => void
  isDispatching: boolean
  hasExisting: boolean
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[420px] bg-white rounded-xl border border-gray-200 p-12 text-center">
      <div className="text-5xl mb-4">🗺️</div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">派遣张骞</h2>
      <p className="text-sm text-gray-500 mb-2 max-w-sm">
        仅需一个域名，张骞将自动发现品牌数据
      </p>
      <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-700 font-medium mb-6">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        预计费用 ~$0.75 / 约2分钟
      </div>
      <button
        onClick={onDispatch}
        disabled={isDispatching}
        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isDispatching ? (
          <>
            <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
            派遣中…
          </>
        ) : hasExisting ? '重新运行' : '开始发现'}
      </button>
    </div>
  )
}

// ─── ProgressPanel ────────────────────────────────────────────────────────────

function ProgressPanel({ note, elapsedSec }: { note: string | null; elapsedSec: number }) {
  const mins = Math.floor(elapsedSec / 60)
  const secs = elapsedSec % 60
  const elapsed = mins > 0
    ? `${mins}分${String(secs).padStart(2, '0')}秒`
    : `${secs}秒`

  return (
    <div className="flex flex-col items-center justify-center min-h-[420px] bg-gray-50 rounded-xl border border-gray-200 p-12 text-center gap-6">
      <div className="relative w-16 h-16">
        <span className="absolute inset-0 rounded-full border-4 border-indigo-100" />
        <span className="absolute inset-0 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin" />
        <span className="absolute inset-0 flex items-center justify-center text-2xl">🗺️</span>
      </div>
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-1">张骞正在探索…</h2>
        <p className="text-sm text-gray-500 max-w-xs mx-auto min-h-[2.5rem]">
          {note ?? '正在启动…'}
        </p>
      </div>
      <div className="text-xs text-gray-400 tabular-nums">
        已用时 {elapsed}
      </div>
    </div>
  )
}

// ─── BusinessCard ─────────────────────────────────────────────────────────────

function BusinessCard({ discovery }: { discovery: ClientDiscoveryRow }) {
  const biz = discovery.payload.business
  return (
    <CardShell title="品牌概览">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-gray-900 text-base">{biz.name}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {[biz.location.city, biz.location.region, biz.location.country].filter(Boolean).join(', ')}
          </p>
        </div>
        <Badge className={biz.confidence >= 0.7 ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}>
          置信度 {Math.round(biz.confidence * 100)}%
        </Badge>
      </div>
      <ConfidenceBar value={biz.confidence} />
      <div className="flex flex-wrap gap-1">
        {biz.industry.map(tag => (
          <Badge key={tag} className="bg-gray-100 text-gray-600">{tag}</Badge>
        ))}
      </div>
      <p className="text-xs text-gray-600 leading-relaxed">{biz.description}</p>
      {biz.unique_selling_points.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">核心卖点</p>
          <ul className="space-y-0.5">
            {biz.unique_selling_points.map((usp, i) => (
              <li key={i} className="text-xs text-gray-600 flex items-start gap-1">
                <span className="text-indigo-400 mt-0.5">•</span>{usp}
              </li>
            ))}
          </ul>
        </div>
      )}
    </CardShell>
  )
}

// ─── KeywordsCard ─────────────────────────────────────────────────────────────

function KeywordsCard({ keywords }: { keywords: DiscoveredKeyword[] }) {
  return (
    <CardShell title="种子关键词">
      <ul className="space-y-2">
        {keywords.map((kw, i) => (
          <li key={i} className="flex items-center justify-between gap-2">
            <span className="text-sm text-gray-800 flex-1 truncate">{kw.keyword}</span>
            <Badge className={KEYWORD_TYPE_STYLES[kw.type]}>
              {KEYWORD_TYPE_LABELS[kw.type]}
            </Badge>
          </li>
        ))}
      </ul>
    </CardShell>
  )
}

// ─── CompetitorsCard ──────────────────────────────────────────────────────────

function CompetitorsCard({ competitors }: { competitors: DiscoveredCompetitor[] }) {
  return (
    <CardShell title="竞争对手">
      <ul className="space-y-3">
        {competitors.map((c, i) => (
          <li key={i} className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{c.name}</p>
              <p className="text-xs text-gray-400 truncate">{c.domain}</p>
            </div>
            <Badge className={RELEVANCE_STYLES[c.relevance]}>
              {RELEVANCE_LABELS[c.relevance]}
            </Badge>
          </li>
        ))}
      </ul>
    </CardShell>
  )
}

// ─── SocialCard ───────────────────────────────────────────────────────────────

function SocialCard({ socials }: { socials: DiscoveredSocial[] }) {
  if (socials.length === 0) {
    return (
      <CardShell title="社媒账号">
        <p className="text-sm text-gray-400 text-center py-4">未发现社媒账号</p>
      </CardShell>
    )
  }
  return (
    <CardShell title="社媒账号">
      <ul className="space-y-2">
        {socials.map((s, i) => (
          <li key={i} className="flex items-center gap-3">
            <span className="text-lg">{PLATFORM_ICONS[s.platform]}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-700 capitalize">{s.platform}</p>
              {s.handle && <p className="text-xs text-gray-400">{s.handle}</p>}
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-indigo-500 hover:underline truncate block"
              >
                {s.url}
              </a>
            </div>
            <ConfidenceBar value={s.confidence} />
          </li>
        ))}
      </ul>
    </CardShell>
  )
}

// ─── GbpCard ──────────────────────────────────────────────────────────────────

function GbpCard({ gbp }: { gbp: ClientDiscoveryRow['payload']['gbp'] }) {
  if (!gbp) {
    return (
      <CardShell title="Google 商业档案">
        <p className="text-sm text-gray-400 text-center py-4">未发现</p>
      </CardShell>
    )
  }
  const stars = gbp.rating != null ? Math.round(gbp.rating) : 0
  return (
    <CardShell title="Google 商业档案">
      <p className="text-sm font-medium text-gray-900">{gbp.business_name}</p>
      <p className="text-xs text-gray-500">{gbp.address}</p>
      {gbp.rating != null && (
        <div className="flex items-center gap-2">
          <div className="flex text-yellow-400 text-sm">
            {'★'.repeat(stars)}{'☆'.repeat(5 - stars)}
          </div>
          <span className="text-xs text-gray-600">{gbp.rating.toFixed(1)}</span>
          {gbp.review_count != null && (
            <span className="text-xs text-gray-400">({gbp.review_count} 条评价)</span>
          )}
        </div>
      )}
      <ConfidenceBar value={gbp.confidence} />
      {gbp.google_maps_url && (
        <a
          href={gbp.google_maps_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-indigo-500 hover:underline"
        >
          在 Google Maps 查看 →
        </a>
      )}
    </CardShell>
  )
}

// ─── AiQuestionsCard ──────────────────────────────────────────────────────────

function AiQuestionsCard({ questions }: { questions: DiscoveredAiQuestion[] }) {
  return (
    <CardShell title="AI Tracker 问句">
      <ul className="space-y-2">
        {questions.map((q, i) => (
          <li key={i} className="flex items-start gap-2">
            <Badge className={AI_CATEGORY_STYLES[q.category]}>
              {AI_CATEGORY_LABELS[q.category]}
            </Badge>
            <p className="text-xs text-gray-700 flex-1 leading-relaxed">{q.question}</p>
          </li>
        ))}
      </ul>
    </CardShell>
  )
}

// ─── NotesCard ────────────────────────────────────────────────────────────────

function NotesCard({ notes }: { notes: string }) {
  if (!notes.trim()) return null
  return (
    <CardShell title="探索备注">
      <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">{notes}</p>
    </CardShell>
  )
}

// ─── DiscoveryReviewCards ─────────────────────────────────────────────────────

function DiscoveryReviewCards({
  discovery,
  onConfirm,
  isConfirming,
}: {
  discovery: ClientDiscoveryRow
  onConfirm: () => void
  isConfirming: boolean
}) {
  const p = discovery.payload
  return (
    <div className="space-y-5">
      {/* Meta bar */}
      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
        <span>域名: <strong className="text-gray-700">{discovery.domain}</strong></span>
        <span>费用: <strong className="text-gray-700">${discovery.cost_usd.toFixed(3)}</strong></span>
        <span>工具调用: <strong className="text-gray-700">{discovery.tool_calls}</strong></span>
        <span>生成时间: <strong className="text-gray-700">{new Date(discovery.generated_at).toLocaleString('zh-CN', { timeZone: 'Pacific/Auckland' })}</strong></span>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BusinessCard discovery={discovery} />
        <KeywordsCard keywords={p.seed_keywords} />
        <CompetitorsCard competitors={p.competitors} />
        <SocialCard socials={p.social_profiles} />
        <GbpCard gbp={p.gbp} />
        <AiQuestionsCard questions={p.ai_tracker_questions} />
      </div>
      {p.notes && <NotesCard notes={p.notes} />}

      {/* Confirm button */}
      <div className="flex justify-end pt-2">
        <button
          onClick={onConfirm}
          disabled={isConfirming}
          className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-6 py-3 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isConfirming ? (
            <>
              <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              导入中…
            </>
          ) : '确认并导入'}
        </button>
      </div>
    </div>
  )
}

// ─── ConfirmedBanner ─────────────────────────────────────────────────────────

function ConfirmedBanner({ onRerun }: { onRerun: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[420px] bg-white rounded-xl border border-green-200 p-12 text-center">
      <div className="text-5xl mb-4">✅</div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">发现结果已确认</h2>
      <p className="text-sm text-gray-500 mb-6 max-w-sm">
        张骞发现的数据已成功导入客户档案。
      </p>
      <button
        onClick={onRerun}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        重新运行
      </button>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ZhangqianPage() {
  const params = useParams()
  const clientId = params.id as string
  const router = useRouter()

  const [pageState, setPageState] = useState<PageState>('idle')
  const [discovery, setDiscovery] = useState<ClientDiscoveryRow | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progressNote, setProgressNote] = useState<string | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [pageLoading, setPageLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [isDispatching, setIsDispatching] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_KEY}`,
  }

  // ── Fetch latest ────────────────────────────────────────────────────────────

  const fetchLatest = useCallback(async () => {
    setPageLoading(true)
    setPageError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/zhangqian/latest`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      })
      if (res.status === 404) {
        setDiscovery(null)
        setPageState('idle')
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: LatestResponse = await res.json()
      if (data.success && data.discovery) {
        setDiscovery(data.discovery)
        setPageState(data.discovery.confirmed_at ? 'confirmed' : 'reviewing')
      } else {
        setDiscovery(null)
        setPageState('idle')
      }
    } catch (e) {
      setPageError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setPageLoading(false)
    }
  }, [clientId])

  useEffect(() => { void fetchLatest() }, [fetchLatest])

  // ── Polling cleanup ─────────────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null }
  }, [])

  useEffect(() => () => stopPolling(), [stopPolling])

  // ── Poll status ─────────────────────────────────────────────────────────────

  const startPolling = useCallback((jid: string) => {
    startTimeRef.current = Date.now()
    setElapsedSec(0)
    elapsedRef.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)

    const poll = async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/zhangqian/status?job_id=${encodeURIComponent(jid)}`, {
          headers: { Authorization: `Bearer ${API_KEY}` },
        })
        if (!res.ok) return
        const data: StatusResponse = await res.json()
        if (!data.success) return
        const job = data.job
        if (job.progress_note) setProgressNote(job.progress_note)
        if (job.status === 'completed') {
          stopPolling()
          await fetchLatest()
        } else if (job.status === 'failed') {
          stopPolling()
          setPageError(job.error_message ?? '发现失败，请重试')
          setPageState('idle')
        }
      } catch {
        // non-fatal polling error
      }
    }

    void poll()
    pollRef.current = setInterval(() => { void poll() }, 3000)
  }, [clientId, fetchLatest, stopPolling])

  // ── Dispatch ────────────────────────────────────────────────────────────────

  const handleDispatch = async () => {
    setIsDispatching(true)
    setPageError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/zhangqian/discover`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: DiscoverResponse = await res.json()
      if (!data.success) throw new Error(data.error ?? '派遣失败')
      setJobId(data.job_id)
      setProgressNote(null)
      setPageState('running')
      startPolling(data.job_id)
    } catch (e) {
      setPageError(e instanceof Error ? e.message : '派遣失败')
    } finally {
      setIsDispatching(false)
    }
  }

  // ── Confirm ─────────────────────────────────────────────────────────────────

  const handleConfirm = async () => {
    setIsConfirming(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/zhangqian/confirm`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ confirmed_by: 'user' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: ConfirmResponse = await res.json()
      if (!data.success) throw new Error(data.error ?? '确认失败')
      // Redirect to client workspace after confirmation
      router.push(`/dashboard/clients/${clientId}`)
    } catch (e) {
      setPageError(e instanceof Error ? e.message : '确认失败')
    } finally {
      setIsConfirming(false)
    }
  }

  const handleRerun = () => {
    setDiscovery(null)
    setPageState('idle')
    setPageError(null)
    setJobId(null)
  }

  // ─── Loading skeleton ──────────────────────────────────────────────────────

  if (pageLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 animate-pulse">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="h-7 w-48 bg-gray-200 rounded" />
          <div className="h-96 rounded-xl bg-gray-200" />
        </div>
      </div>
    )
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href={`/dashboard/clients/${clientId}`}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
              aria-label="返回客户页"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              返回
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">张骞发现</h1>
              {discovery?.generated_at && (
                <p className="text-xs text-gray-400 mt-0.5">
                  上次运行：{new Date(discovery.generated_at).toLocaleString('zh-CN', { timeZone: 'Pacific/Auckland' })}
                </p>
              )}
            </div>
          </div>

          {/* Header re-run button when reviewing */}
          {pageState === 'reviewing' && (
            <button
              onClick={() => void handleDispatch()}
              disabled={isDispatching}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              重新运行
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Error banner */}
        {pageError && (
          <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between gap-3">
            <span>{pageError}</span>
            <button onClick={() => setPageError(null)} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
          </div>
        )}

        {/* State views */}
        {pageState === 'idle' && (
          <DispatchPanel
            onDispatch={() => void handleDispatch()}
            isDispatching={isDispatching}
            hasExisting={discovery !== null}
          />
        )}

        {pageState === 'running' && (
          <ProgressPanel note={progressNote} elapsedSec={elapsedSec} />
        )}

        {pageState === 'reviewing' && discovery && (
          <DiscoveryReviewCards
            discovery={discovery}
            onConfirm={() => void handleConfirm()}
            isConfirming={isConfirming}
          />
        )}

        {pageState === 'confirmed' && (
          <div className="space-y-5">
            <ConfirmedBanner onRerun={handleRerun} />
            {discovery && (
              <DiscoveryReviewCards
                discovery={discovery}
                onConfirm={() => void handleConfirm()}
                isConfirming={isConfirming}
              />
            )}
          </div>
        )}
      </div>

      {/* Suppress unused variable warning for jobId in future use */}
      {jobId && false && <span />}
    </div>
  )
}
