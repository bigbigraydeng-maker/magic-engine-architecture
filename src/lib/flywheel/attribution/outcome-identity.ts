/**
 * flywheel_outcomes identity — Issue #859 (Attribution Correctness)
 *
 * One business outcome = "what did action A do to metric M over a W-day window".
 * That triple is the natural key; it is enforced by the
 * `flywheel_outcomes_natural_key` UNIQUE constraint (migration
 * 20260808000001_flywheel_outcomes_stable_identity.sql).
 *
 * `evaluator_key` is deliberately *not* part of the key. Two evaluators that
 * answer the same (action, metric, window) question are producing competing
 * answers to one fact, not two facts. The column exists so each writer can
 * reconcile only the rows it owns — a writer must never delete another
 * writer's rows, and must never leave the table empty if its own write fails.
 */

import { SEO_METRIC_KEY } from '@/lib/flywheel/vocabulary'

/** Which attribution pipeline produced a row. Mirrors the DB CHECK constraint. */
export const OUTCOME_EVALUATOR = {
  /** attribution/job.ts — reads flywheel_metrics */
  FLYWHEEL_METRICS: 'flywheel_metrics',
  /** attribution/gsc-bridge.ts — reads gsc_performance_snapshots */
  GSC_SNAPSHOTS: 'gsc_snapshots',
} as const

export type OutcomeEvaluatorKey =
  (typeof OUTCOME_EVALUATOR)[keyof typeof OUTCOME_EVALUATOR]

/**
 * `onConflict` target for every flywheel_outcomes upsert. Must stay in sync
 * with the UNIQUE constraint; the column order is the constraint's order.
 */
export const OUTCOME_CONFLICT_TARGET = 'action_id,metric_key,window_days'

/**
 * Every metric_key the GSC evaluator can emit — domain scope and page scope.
 * Used to work out which of *its own* rows an action no longer has, so they can
 * be retired without touching any other evaluator's rows.
 */
export const GSC_EVALUATOR_METRIC_KEYS: readonly string[] = [
  SEO_METRIC_KEY.GSC_CLICKS,
  SEO_METRIC_KEY.GSC_IMPRESSIONS,
  SEO_METRIC_KEY.GSC_AVG_POSITION,
  SEO_METRIC_KEY.GSC_PAGE_CLICKS,
  SEO_METRIC_KEY.GSC_PAGE_IMPRESSIONS,
  SEO_METRIC_KEY.GSC_PAGE_AVG_POSITION,
]

/**
 * The canonical handle for an outcome's natural key. Mirrors the `outcome_key`
 * generated column so application code and SQL agree on one spelling.
 */
export function buildOutcomeKey(
  actionId: string,
  metricKey: string,
  windowDays: number,
): string {
  return `${actionId}:${metricKey}:${windowDays}`
}

/**
 * Given the metric keys an evaluator just wrote for an action, return the keys
 * it owns but did not produce this run — i.e. the rows that are no longer true
 * and should be retired.
 *
 * Returns [] when `writtenKeys` is empty: producing nothing is not evidence
 * that the previous answer was wrong, so a barren run must never retire
 * anything (fail closed).
 */
export function resolveStaleEvaluatorKeys(
  ownedKeys: readonly string[],
  writtenKeys: readonly string[],
): string[] {
  if (writtenKeys.length === 0) return []
  const written = new Set(writtenKeys)
  return ownedKeys.filter(key => !written.has(key))
}
