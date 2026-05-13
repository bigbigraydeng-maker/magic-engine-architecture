import type { DiagnosticFinding } from '@/types/diagnostic'

// Finding shape produced by a collector — id/run_id/created_at are assigned on persist
export type NewFinding = Omit<DiagnosticFinding, 'id' | 'run_id' | 'created_at'>

export interface CollectorResult {
  /**
   * 0–100 integer when the dimension can be evaluated.
   * `null` when prerequisite data is missing (e.g. no keywords configured,
   * business not listed on Google, no social accounts linked).
   * `null` dimensions are excluded from overall_score weighting and rendered
   * as "未配置 / Not configured" in the UI.
   */
  score: number | null
  findings: NewFinding[]
}
