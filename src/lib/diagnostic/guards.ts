import type { DiagnosticDimension, DiagnosticSeverity } from '@/types/diagnostic'
import { DIMENSION_WEIGHTS } from './constants'

const DIMENSIONS: ReadonlySet<string> = new Set<DiagnosticDimension>([
  'seo', 'ai_visibility', 'ads', 'social', 'reputation', 'competitor',
])

const SEVERITIES: ReadonlySet<string> = new Set<DiagnosticSeverity>([
  'critical', 'high', 'medium', 'low', 'info',
])

export function isDiagnosticDimension(value: unknown): value is DiagnosticDimension {
  return typeof value === 'string' && DIMENSIONS.has(value)
}

export function isDiagnosticSeverity(value: unknown): value is DiagnosticSeverity {
  return typeof value === 'string' && SEVERITIES.has(value)
}

export function isValidScore(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 100
  )
}

/**
 * Weighted average of dimension scores using DIMENSION_WEIGHTS.
 * Only includes dimensions present in the breakdown; weights are re-normalised
 * so partial breakdowns still produce a meaningful 0–100 result.
 */
export function computeOverallScore(
  breakdown: Partial<Record<DiagnosticDimension, number>>,
): number {
  let weighted = 0
  let totalWeight = 0

  for (const [dim, score] of Object.entries(breakdown)) {
    if (!isDiagnosticDimension(dim) || score === undefined) continue
    const weight = DIMENSION_WEIGHTS[dim]
    weighted += score * weight
    totalWeight += weight
  }

  if (totalWeight === 0) return 0
  return Math.round(weighted / totalWeight)
}
