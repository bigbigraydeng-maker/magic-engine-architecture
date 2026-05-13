'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import type { ExecutionItem, ExecutionItemStatus } from '@/types/diagnostic'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_KEY = process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? ''

const FIX_TYPE_META: Record<string, { icon: string; label: string }> = {
  me_auto:     { icon: '🤖', label: 'ME 自动' },
  fde_manual:  { icon: '👤', label: 'FDE 手动' },
  third_party: { icon: '🔗', label: '第三方' },
}

const STATUS_META: Record<ExecutionItemStatus, { label: string; color: string }> = {
  pending:     { label: '待处理', color: 'bg-gray-100 text-gray-600' },
  in_progress: { label: '进行中', color: 'bg-blue-100 text-blue-700' },
  completed:   { label: '已完成', color: 'bg-green-100 text-green-700' },
  skipped:     { label: '已跳过', color: 'bg-yellow-100 text-yellow-700' },
}

const PHASE_LABELS: Record<number, { name: string; color: string }> = {
  1: { name: 'Phase 1 — 即时修复',  color: 'bg-indigo-600' },
  2: { name: 'Phase 2 — 结构改善',  color: 'bg-purple-600' },
  3: { name: 'Phase 3 — 长期增长',  color: 'bg-teal-600'   },
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100)
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
      <div className="flex-1">
        <div className="flex justify-between items-center mb-1">
          <span className="text-sm font-medium text-gray-700">整体执行进度</span>
          <span className="text-sm font-bold text-indigo-700">{pct}%</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2">
          <div
            className="bg-indigo-500 h-2 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="text-right whitespace-nowrap">
        <span className="text-2xl font-bold text-indigo-700">{completed}</span>
        <span className="text-sm text-gray-400"> / {total}</span>
      </div>
    </div>
  )
}

function ExecutionItemRow({
  item,
  onComplete,
}: {
  item: ExecutionItem
  onComplete: (id: string) => void
}) {
  const stepsJson = item.steps_json as Record<string, unknown> | null
  const deeplink  = stepsJson?.deeplink as string | undefined
  const fixMeta   = FIX_TYPE_META[item.fix_type] ?? { icon: '❓', label: item.fix_type }
  const statusM   = STATUS_META[item.status]

  return (
    <div className={`rounded-lg border bg-white p-4 flex items-start gap-3 ${
      item.status === 'completed' ? 'opacity-60' : ''
    }`}>
      {/* Owner type icon */}
      <span className="text-xl mt-0.5" title={fixMeta.label}>{fixMeta.icon}</span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className={`text-sm font-semibold ${item.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-900'}`}>
              {item.title}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
          </div>

          {/* Status badge */}
          <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${statusM.color}`}>
            {statusM.label}
          </span>
        </div>

        {/* Owner + deeplink */}
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <span className="text-xs text-gray-400">{fixMeta.label}</span>
          {deeplink && item.fix_type === 'me_auto' && (
            <a
              href={deeplink.replace('{clientId}', item.client_id)}
              className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            >
              打开工具 ↗
            </a>
          )}
        </div>
      </div>

      {/* Action button */}
      {item.status !== 'completed' && item.status !== 'skipped' && (
        <button
          onClick={() => onComplete(item.id)}
          className="shrink-0 rounded-lg bg-green-50 border border-green-200 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100 transition-colors"
        >
          ✓ 标记完成
        </button>
      )}
    </div>
  )
}

function PhaseAccordion({
  phase,
  items,
  defaultOpen,
  onComplete,
}: {
  phase: number
  items: ExecutionItem[]
  defaultOpen: boolean
  onComplete: (id: string) => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const meta      = PHASE_LABELS[phase] ?? { name: `Phase ${phase}`, color: 'bg-gray-600' }
  const completed = items.filter(i => i.status === 'completed').length

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 bg-white hover:bg-gray-50 transition-colors"
      >
        <span className={`w-2 h-2 rounded-full ${meta.color}`} />
        <span className="font-semibold text-gray-900 flex-1 text-left">{meta.name}</span>
        <span className="text-xs text-gray-400">
          {completed}/{items.length} 完成
        </span>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="bg-gray-50 border-t border-gray-100 p-4 space-y-2">
          {items.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">此阶段暂无执行项</p>
          ) : (
            items.map(item => (
              <ExecutionItemRow key={item.id} item={item} onComplete={onComplete} />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ExecutionPage() {
  const params        = useParams()
  const searchParams  = useSearchParams()
  const clientId      = params.id as string
  const prescriptionId = searchParams.get('prescription_id') ?? undefined

  const [items, setItems]           = useState<ExecutionItem[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)

  const fetchItems = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = prescriptionId ? `?prescription_id=${prescriptionId}` : ''
      const res = await fetch(`/api/clients/${clientId}/execution${qs}`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { items: ExecutionItem[] }
      setItems(data.items ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [clientId, prescriptionId])

  useEffect(() => { void fetchItems() }, [fetchItems])

  const handleComplete = useCallback(async (itemId: string) => {
    try {
      const res = await fetch(`/api/clients/${clientId}/execution/${itemId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body:    JSON.stringify({ status: 'completed' }),
      })
      if (!res.ok) return
      setItems(prev =>
        prev.map(i =>
          i.id === itemId
            ? { ...i, status: 'completed', completed_at: new Date().toISOString() }
            : i
        )
      )
    } catch {
      // non-fatal
    }
  }, [clientId])

  // Group items by phase
  const byPhase: Record<number, ExecutionItem[]> = {}
  for (const item of items) {
    const ph = item.phase ?? 1
    if (!byPhase[ph]) byPhase[ph] = []
    byPhase[ph].push(item)
  }

  const completedCount = items.filter(i => i.status === 'completed').length

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 animate-pulse">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="h-7 w-56 bg-gray-200 rounded" />
          <div className="h-14 bg-gray-200 rounded-xl" />
          {[1, 2, 3].map(i => <div key={i} className="h-24 bg-gray-200 rounded-xl" />)}
        </div>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
            {error}
          </div>
        </div>
      </div>
    )
  }

  // ── Empty ─────────────────────────────────────────────────────────────────
  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center space-y-3">
            <p className="text-4xl">📋</p>
            <h2 className="font-semibold text-gray-900">暂无执行计划</h2>
            <p className="text-sm text-gray-500">
              请先生成并批准一份处方，系统将自动创建执行计划。
            </p>
            <a
              href={`/dashboard/clients/${clientId}/prescription/new`}
              className="inline-block rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
            >
              生成处方
            </a>
          </div>
        </div>
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">执行看板</h1>
            <p className="text-xs text-gray-400 mt-0.5">按阶段跟踪处方执行进度</p>
          </div>
          <a
            href={`/dashboard/clients/${clientId}/prescription/new`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-700 transition-colors"
          >
            ＋ 新处方
          </a>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">
        {/* Progress bar */}
        <ProgressBar completed={completedCount} total={items.length} />

        {/* Phase accordions — Phase 1 open by default, 2 + 3 collapsed */}
        {[1, 2, 3].map(phase => (
          <PhaseAccordion
            key={phase}
            phase={phase}
            items={byPhase[phase] ?? []}
            defaultOpen={phase === 1}
            onComplete={handleComplete}
          />
        ))}
      </div>
    </div>
  )
}
