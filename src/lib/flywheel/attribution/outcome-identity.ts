/**
 * flywheel_outcomes identity — Issue #859 (Attribution Correctness)
 *
 * One business outcome = "what did action A do to metric M over a W-day window".
 * That triple is the natural key; it is enforced by the
 * `flywheel_outcomes_natural_key` UNIQUE constraint (migration
 * 20260808000001_flywheel_outcomes_identity_expand.sql).
 *
 * `evaluator_key` is deliberately *not* part of the key. Two evaluators that
 * answer the same (action, metric, window) question are producing competing
 * answers to one fact, not two facts.
 *
 * That decision only holds up if a natural key can never be produced by two
 * evaluators, because otherwise "which answer is true" degrades into "which
 * writer ran last" — and a stable row id whose verdict flips with the cron
 * schedule is worse than an unstable one, since downstream memory would read
 * scheduling noise as a business reversal.
 *
 * So ownership is assigned per metric family, below: exactly one evaluator is
 * authoritative for any given metric_key, and a non-owner declines to write
 * rather than competing. Execution order cannot decide truth because only one
 * writer ever produces the row. The same rule is enforced in the database by
 * `flywheel_outcomes_evaluator_owns_metric`.
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
 * Metric families whose authoritative evaluator is not the default.
 *
 * `seo.gsc.*` belongs to the GSC bridge: it reads `gsc_performance_snapshots`,
 * which is Search Console's own account of those numbers, with a baseline and
 * an after snapshot chosen for the window. `job.ts` can also reach those keys
 * — `flywheel_metrics` carries `seo.gsc.clicks` / `impressions` /
 * `avg_position` (99 rows each in production) — but only as a daily-pulled
 * copy, so its answer is the derivative one.
 *
 * Longest matching prefix wins, so a narrower family can be carved out later
 * without disturbing the ones above it.
 */
const METRIC_FAMILY_OWNERS: ReadonlyArray<{
  prefix: string
  evaluator: OutcomeEvaluatorKey
}> = [{ prefix: 'seo.gsc.', evaluator: OUTCOME_EVALUATOR.GSC_SNAPSHOTS }]

/** Every metric family not claimed above is the flywheel_metrics evaluator's. */
const DEFAULT_METRIC_OWNER: OutcomeEvaluatorKey = OUTCOME_EVALUATOR.FLYWHEEL_METRICS

/**
 * The one evaluator allowed to write outcomes for this metric. Total function:
 * every metric_key has exactly one owner, so no natural key is ever contested.
 */
export function resolveAuthoritativeEvaluator(metricKey: string): OutcomeEvaluatorKey {
  let owner = DEFAULT_METRIC_OWNER
  let matched = -1

  for (const family of METRIC_FAMILY_OWNERS) {
    if (metricKey.startsWith(family.prefix) && family.prefix.length > matched) {
      owner = family.evaluator
      matched = family.prefix.length
    }
  }

  return owner
}

/** Whether `evaluator` is the authoritative writer for `metricKey`. */
export function ownsMetric(evaluator: OutcomeEvaluatorKey, metricKey: string): boolean {
  return resolveAuthoritativeEvaluator(metricKey) === evaluator
}

/**
 * Guard for a writer about to persist a batch: every metric in it must belong
 * to the writer. Throws rather than filtering, because a writer producing a row
 * it does not own is a coding mistake, and dropping it quietly would hide the
 * moment the last-writer-wins race reopened.
 *
 * Unreachable with today's metric families — the GSC bridge only ever builds
 * `seo.gsc.*` keys. It exists so that adding a key to its row builders fails
 * with a legible message instead of a Postgres constraint violation.
 */
export function assertEvaluatorOwnsAll(
  evaluator: OutcomeEvaluatorKey,
  metricKeys: readonly string[],
): void {
  const trespass = metricKeys.filter(key => !ownsMetric(evaluator, key))
  if (trespass.length > 0) {
    throw new Error(
      `${evaluator} is not the authoritative evaluator for: ${trespass.join(', ')}`,
    )
  }
}

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
