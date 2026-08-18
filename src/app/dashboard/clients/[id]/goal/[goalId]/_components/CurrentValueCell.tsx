'use client'

/**
 * A2.1 — Current value cell for the Goal primary metric card.
 *
 * Auto-fetches current_value from /api/goals/[goalId]/fetch-current-value
 * when the metric has measurement='auto' (organic_traffic, brand_search_volume,
 * etc). Shows manual placeholder otherwise.
 *
 * Renders inside the Goal detail page's primary-metric card (4-column grid).
 */

import React, { useEffect, useState, useCallback } from 'react'
import { PRIMARY_METRIC_CATALOG } from '@/types/strategy'
import type { GoalRow } from '@/types/strategy'

// Silence "React unused" while keeping it in scope for JSX under vite-react in tests
void React

interface FetchSuccess {
  ok: true
  value: number
  source: string
  snapshot_date: string
  label: string
}

interface FetchFailure {
  ok: false
  reason: string
  /** true = the metric's auto source was intentionally removed (e.g.
   *  ai_visibility_score after the ai-tracker decommission). A permanent,
   *  non-retryable state — retrying can never succeed. */
  severed?: boolean
}

type FetchResponse = FetchSuccess | FetchFailure

interface Props {
  goal: GoalRow
}

export function CurrentValueCell({ goal }: Props) {
  const metricDef = PRIMARY_METRIC_CATALOG.find(m => m.key === goal.primary_metric_key)
  // Includes 'hybrid' — these have a partially-auto data source (e.g. leads_count
  // = GA4 forms + manual phone/wechat). Endpoint already allows hybrid; UI must
  // attempt the fetch so the auto half lands and FDE knows to top up manually.
  const isAuto = metricDef?.measurement === 'auto' || metricDef?.measurement === 'hybrid'

  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [result, setResult] = useState<FetchSuccess | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Permanent, non-retryable state: the metric's auto source was removed. Never
  // show a "retry" button here — retrying can only ever fail again.
  const [severed, setSevered] = useState(false)

  const fetchValue = useCallback(async (manualRefresh: boolean) => {
    if (manualRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/goals/${goal.id}/fetch-current-value`, {
        cache: 'no-store',
      })
      const json = await res.json() as FetchResponse
      if (json.ok) {
        setResult(json)
        setSevered(false)
      } else {
        setError(json.reason)
        setSevered(json.severed === true)
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [goal.id])

  // Auto-fetch on mount (only for auto-measurement metrics)
  useEffect(() => {
    if (!isAuto) return
    void fetchValue(false)
  }, [isAuto, fetchValue])

  // Manual / self_report path: show last-submitted-by-FDE value if any.
  // The judge endpoint stores it on the goal during early-submit / 90-day judge.
  // We hint how to update so PM/FDE knows where to enter it.
  //
  // Note: 'hybrid' metrics go through the isAuto branch above (the auto half
  // gets fetched; FDE manually tops up). Only pure self_report + unknown
  // (catalog miss) land here.
  if (!isAuto) {
    const hint = metricDef?.measurement === 'self_report'
      ? '客户自报 · 用「Submit Verdict」录入'
      : metricDef
        ? '手动填写'
        : '未识别指标 · 请检查 metric_catalog'  // catalog miss (custom key) — visible signal not silent
    return (
      <div>
        <div className="text-[11px] font-black uppercase text-me-charcoal/45">Current</div>
        <div className="text-lg font-bold text-me-charcoal/40">—</div>
        <div className="text-[10px] font-semibold text-me-charcoal/45">{hint}</div>
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5">
        <div className="text-[11px] font-black uppercase text-me-charcoal/45">Current</div>
        {result && !loading && (
          <button
            type="button"
            onClick={() => void fetchValue(true)}
            disabled={refreshing}
            title={`刷新自动获取（数据源: ${result.source}）`}
            className="text-[10px] text-me-charcoal/30 hover:text-me-ochre disabled:opacity-40"
          >
            {refreshing ? '⏳' : '↻'}
          </button>
        )}
      </div>

      {loading && (
        <>
          <div className="text-lg font-bold text-me-charcoal/40">…</div>
          <div className="text-[10px] font-semibold text-me-charcoal/45">获取中</div>
        </>
      )}

      {!loading && result && (
        <>
          <div className="text-lg font-bold text-me-charcoal">
            {result.value.toLocaleString()}
          </div>
          <div className="text-[10px] font-semibold text-me-ochre" title={result.label}>
            ⚡ {result.source}
            {metricDef?.measurement === 'hybrid' && (
              <span className="ml-1 text-me-charcoal/55">· FDE 补录其他渠道</span>
            )}
          </div>
        </>
      )}

      {/* Severed source (e.g. ai_visibility_score after ai-tracker decommission):
          not measured, and retrying can never succeed — so NO retry button. */}
      {!loading && error && severed && (
        <>
          <div className="text-lg font-bold text-me-charcoal/40">—</div>
          <div className="text-[10px] font-semibold text-me-charcoal/45" title={error}>
            AI 可见度测量迁移中 · 暂不可用（不可重试）
          </div>
        </>
      )}

      {!loading && error && !severed && (
        <>
          <div className="text-lg font-bold text-me-charcoal/40">—</div>
          <div className="text-[10px] font-semibold text-me-charcoal/45" title={error}>
            {metricDef?.measurement === 'hybrid' ? '自动源未取到 · 全部用 FDE 录入 · ' : '未获取到 · '}<button
              type="button"
              onClick={() => void fetchValue(true)}
              className="underline hover:text-me-ochre"
            >
              重试
            </button>
          </div>
        </>
      )}
    </div>
  )
}
