'use client'

import { useState, useEffect } from 'react'
import { GenerationQueueItem } from '@/lib/visual/generation-config'
import { getProgressPercent, formatCountdown } from '@/lib/visual/progress-utils'

interface QueueOverviewCardProps {
  activeGenerations: Record<string, GenerationQueueItem>
  onScrollTo?: (postId: string) => void
}

const ASSET_ICON: Record<GenerationQueueItem['assetType'], string> = {
  image: '🖼️',
  video: '🎬',
  avatar_video: '🎭',
}

export function QueueOverviewCard({ activeGenerations, onScrollTo }: QueueOverviewCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const entries = Object.entries(activeGenerations)
  const count = entries.length

  // Auto-expand when 2 or more items are active
  useEffect(() => {
    if (count >= 2) {
      setIsExpanded(true)
    }
  }, [count])

  // Do not render when queue is empty
  if (count === 0) return null

  if (!isExpanded) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <button
          onClick={() => setIsExpanded(true)}
          className="w-10 h-10 rounded-full bg-gray-900 text-white text-sm font-bold shadow-lg flex items-center justify-center hover:bg-gray-700 transition-colors"
          aria-label={`${count} active generation${count > 1 ? 's' : ''}`}
        >
          {count}
        </button>
      </div>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="bg-white border border-gray-200 shadow-xl rounded-xl w-72">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <span className="text-sm font-semibold text-gray-800">生成中 ({count})</span>
          <button
            onClick={() => setIsExpanded(false)}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
            aria-label="收起"
          >
            ×
          </button>
        </div>

        {/* Task list */}
        <ul className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
          {entries.map(([postId, item]) => {
            const elapsedMs = (item.elapsed ?? 0) * 1000
            const estimatedMs = item.estimatedRemainingMs ?? 180000
            const progress = getProgressPercent(elapsedMs, elapsedMs + estimatedMs)
            const countdown = formatCountdown(estimatedMs)
            const icon = ASSET_ICON[item.assetType]

            return (
              <li
                key={postId}
                onClick={() => onScrollTo?.(postId)}
                className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors"
              >
                <span className="text-base flex-shrink-0">{icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-700 truncate">
                    {item.stage ?? 'Processing…'}
                  </p>
                  {/* Progress bar */}
                  <div className="mt-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[10px] font-medium text-gray-600">{Math.round(progress)}%</p>
                  <p className="text-[10px] text-gray-400">{countdown}</p>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
