'use client'

import React from 'react'
import { formatCountdown } from '@/lib/visual/progress-utils'

interface CountdownTextProps {
  remainingMs: number
}

export function CountdownText({ remainingMs }: CountdownTextProps) {
  return (
    <span
      data-testid="countdown-text"
      className="text-amber-500 font-semibold"
    >
      {formatCountdown(remainingMs)}
    </span>
  )
}
