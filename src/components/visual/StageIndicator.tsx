'use client'

import React from 'react'

interface StageIndicatorProps {
  currentStageIndex: number
  totalStages: number
}

export function StageIndicator({ currentStageIndex, totalStages }: StageIndicatorProps) {
  // Cycle back to stage 0 if currentStageIndex equals totalStages
  const effectiveStageIndex = currentStageIndex % totalStages

  return (
    <div
      data-testid="stage-dots-container"
      className="flex gap-2"
    >
      {Array.from({ length: totalStages }).map((_, index) => (
        <div
          key={index}
          data-testid="stage-dot"
          className={`w-2 h-2 rounded-full bg-blue-500 transition-opacity duration-300 ${
            index === effectiveStageIndex ? 'opacity-100' : 'opacity-40'
          }`}
        />
      ))}
    </div>
  )
}
