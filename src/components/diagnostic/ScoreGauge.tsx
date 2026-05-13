'use client'

import React from 'react'
import { SCORE_THRESHOLDS } from '@/lib/diagnostic/constants'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScoreTier = 'green' | 'amber' | 'red'

export interface ScoreGaugeProps {
  /** 0–100 numeric score, or `null` when the dimension has no data (rendered as "未配置"). */
  score: number | null
  dimension?: string
  loading?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTier(score: number): ScoreTier {
  if (score >= SCORE_THRESHOLDS.green) return 'green'
  if (score >= SCORE_THRESHOLDS.amber) return 'amber'
  return 'red'
}

// ---------------------------------------------------------------------------
// Style maps
// ---------------------------------------------------------------------------

const TIER_STYLES: Record<ScoreTier, string> = {
  green: 'bg-green-50 border-green-200 text-green-700',
  amber: 'bg-orange-50 border-orange-200 text-orange-700',
  red:   'bg-red-50 border-red-200 text-red-700',
}

const SCORE_STYLES: Record<ScoreTier, string> = {
  green: 'text-green-700',
  amber: 'text-orange-600',
  red:   'text-red-600',
}

const TIER_LABELS: Record<ScoreTier, string> = {
  green: '健康',
  amber: '待改善',
  red:   '危险',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScoreGauge({ score, dimension, loading = false }: ScoreGaugeProps): React.ReactElement {
  if (loading) {
    return (
      <div
        data-testid="score-gauge-skeleton"
        className="animate-pulse rounded-xl border border-gray-200 bg-gray-100 p-5 flex flex-col items-center gap-2"
      >
        <div className="h-8 w-12 bg-gray-200 rounded" />
        <div className="h-3 w-16 bg-gray-200 rounded" />
        <div className="h-3 w-10 bg-gray-200 rounded" />
      </div>
    )
  }

  // P8.5.25: null = data not available → render gray "未配置" gauge (not "0 危险")
  if (score === null) {
    return (
      <div
        data-testid="score-gauge"
        data-tier="unknown"
        className="rounded-xl border border-gray-200 bg-gray-50 p-5 flex flex-col items-center gap-1 text-center text-gray-500"
      >
        <span
          data-testid="score-value"
          className="text-3xl font-bold tabular-nums text-gray-400"
          aria-label="not configured"
        >
          —
        </span>
        <span
          data-testid="score-label"
          className="text-xs font-semibold uppercase tracking-wide opacity-80"
        >
          未配置
        </span>
        {dimension && (
          <span
            data-testid="score-dimension"
            className="text-xs font-medium text-gray-400 mt-0.5"
          >
            {dimension}
          </span>
        )}
      </div>
    )
  }

  const tier = getTier(score)

  return (
    <div
      data-testid="score-gauge"
      data-tier={tier}
      className={`rounded-xl border p-5 flex flex-col items-center gap-1 text-center ${TIER_STYLES[tier]}`}
    >
      {/* Numeric score */}
      <span
        data-testid="score-value"
        className={`text-3xl font-bold tabular-nums ${SCORE_STYLES[tier]}`}
      >
        {score}
      </span>

      {/* Status label */}
      <span
        data-testid="score-label"
        className="text-xs font-semibold uppercase tracking-wide opacity-80"
      >
        {TIER_LABELS[tier]}
      </span>

      {/* Optional dimension label */}
      {dimension && (
        <span
          data-testid="score-dimension"
          className="text-xs font-medium text-gray-500 mt-0.5"
        >
          {dimension}
        </span>
      )}
    </div>
  )
}
