import type { DiagnosticFinding } from '@/types/diagnostic'

// Finding shape produced by a collector — id/run_id/created_at are assigned on persist
export type NewFinding = Omit<DiagnosticFinding, 'id' | 'run_id' | 'created_at'>

export interface CollectorResult {
  score: number          // 0–100 integer
  findings: NewFinding[]
}
