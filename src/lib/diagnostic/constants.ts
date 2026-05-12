import type { DiagnosticDimension } from '@/types/diagnostic'

// §3.2 — dimension weights must sum to 1.0
export const DIMENSION_WEIGHTS: Record<DiagnosticDimension, number> = {
  seo:           0.25,
  ai_visibility: 0.20,
  ads:           0.20,
  social:        0.15,
  reputation:    0.10,
  competitor:    0.10,
}

// Scores ≥ green → healthy; ≥ amber → warning; below amber → critical
export const SCORE_THRESHOLDS = {
  green: 70,
  amber: 40,
} as const

export const MAX_COLLECTOR_TIMEOUT_MS = 30_000
export const SOCIAL_CACHE_TTL_DAYS = 7
