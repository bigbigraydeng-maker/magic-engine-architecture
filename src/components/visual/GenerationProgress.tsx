'use client'

import React from 'react'
import { StageIndicator } from './StageIndicator'
import { CountdownText } from './CountdownText'
import { shouldEnableCancelButton, getProgressPercent } from '@/lib/visual/progress-utils'

interface GenerationProgressProps {
  currentStageIndex: number
  totalStages: number
  elapsedMs: number
  expectedMs: number
  onCancel: () => void
}

export function GenerationProgress({
  currentStageIndex,
  totalStages,
  elapsedMs,
  expectedMs,
  onCancel,
}: GenerationProgressProps) {
  const progressPercent = getProgressPercent(elapsedMs, expectedMs)
  const remainingMs = Math.max(0, expectedMs - elapsedMs)
  const isCancelEnabled = shouldEnableCancelButton(elapsedMs, expectedMs)

  const circumference = 2 * Math.PI * 45
  const offset = circumference - (progressPercent / 100) * circumference

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Progress Ring */}
      <div className="relative w-32 h-32">
        <svg
          data-testid="progress-ring"
          className="w-full h-full transform -rotate-90"
          style={{ width: '128px', height: '128px' }}
        >
          {/* Background circle */}
          <circle
            cx="64"
            cy="64"
            r="45"
            fill="none"
            stroke="rgba(229, 231, 235, 0.5)"
            strokeWidth="8"
          />
          {/* Progress circle */}
          <circle
            cx="64"
            cy="64"
            r="45"
            fill="none"
            stroke="rgb(59, 130, 246)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.3s ease' }}
            data-value={progressPercent}
          />
        </svg>
        {/* Percentage text in center */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-2xl font-bold text-blue-500">
            {Math.round(progressPercent)}%
          </span>
        </div>
      </div>

      {/* Stage Indicator */}
      <StageIndicator
        currentStageIndex={currentStageIndex}
        totalStages={totalStages}
      />

      {/* Countdown Text */}
      <CountdownText remainingMs={remainingMs} />

      {/* Cancel Button */}
      <button
        data-testid="cancel-button"
        onClick={onCancel}
        disabled={!isCancelEnabled}
        className="px-6 py-2 rounded-lg font-semibold transition-all duration-200 bg-red-500 text-white disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-red-600 disabled:hover:bg-gray-300"
      >
        {isCancelEnabled ? 'Cancel Generation' : 'Processing...'}
      </button>
    </div>
  )
}
