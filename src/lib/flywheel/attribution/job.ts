/**
 * Attribution Job — P12.A.8
 *
 * For every flywheel_action that has an expected_metric:
 *   1. Find the most recent flywheel_metrics row BEFORE the action (baseline).
 *   2. Find the most recent flywheel_metrics row AFTER the action and within
 *      window_days (after_value).
 *   3. Compute delta, delta_pct, verdict, and confidence.
 *   4. Upsert the outcome on its natural key (action_id, metric_key,
 *      window_days) so re-runs update one stable row instead of replacing it.
 *
 * Called by the attribution Cron route (P12.A.9).
 */

import { supabaseAdmin } from '../../supabase'
import type { OutcomeVerdict } from '../adapters/types'
import { OUTCOME_CONFLICT_TARGET, OUTCOME_EVALUATOR, ownsMetric } from './outcome-identity'

/**
 * Pass 1's default attribution window. Exported because the cron route must
 * forward the effective pass-1 window to the GSC bridge: actions this job
 * defers (expected_metric owned by the GSC evaluator) still need their answer
 * computed at THIS window, by the owner — otherwise deferral would silently
 * change which question gets answered. See Issue #859.
 */
export const DEFAULT_WINDOW_DAYS = 14

export interface AttributionJobOptions {
  /** Days after action.executed_at to look for an "after" metric. Default 14. */
  windowDays?: number
  /** Restrict to a single client (e.g. for manual reruns). */
  clientId?: string
}

export interface AttributionJobResult {
  processed: number
  written: number
  skipped: number
  /**
   * Actions whose expected_metric belongs to another evaluator's metric family.
   * Counted separately from `skipped` because nothing is wrong: the outcome is
   * another writer's to produce. Surfaced so "this metric is being handled
   * elsewhere" is visible in the cron summary instead of looking like a gap.
   */
  deferred: number
  /**
   * The clients those deferred actions belong to. A deferral is a promise that
   * the owning evaluator will answer, so the cron route must run pass 2 for
   * every client listed here even if their GSC connector is currently
   * disconnected — the bridge reads historical gsc_performance_snapshots, not
   * the connector, so it can still answer (or harmlessly skip). Without this,
   * a client who disconnects GSC after their actions matured would have
   * outcomes deferred to a pass that never visits them. (Codex P2 round 2 on
   * PR #862.)
   */
  deferredClientIds: string[]
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runAttributionJob(
  options: AttributionJobOptions = {}
): Promise<AttributionJobResult> {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS

  let actionsQuery = supabaseAdmin
    .from('flywheel_actions')
    .select('id, client_id, expected_metric, expected_delta, executed_at')
    .not('expected_metric', 'is', null)

  if (options.clientId) {
    actionsQuery = actionsQuery.eq('client_id', options.clientId)
  }

  const { data: actions, error: actionsError } = await actionsQuery

  if (actionsError) {
    throw new Error(`runAttributionJob: failed to fetch actions — ${actionsError.message}`)
  }

  if (!actions?.length) {
    return { processed: 0, written: 0, skipped: 0, deferred: 0, deferredClientIds: [] }
  }

  let written = 0
  let skipped = 0
  let deferred = 0
  const deferredClients = new Set<string>()

  for (const action of actions) {
    // Arbitration: an outcome belongs to whichever evaluator owns its metric
    // family. Declining here — rather than writing and letting the last writer
    // win — is what keeps execution order out of the answer. See Issue #859.
    if (!ownsMetric(OUTCOME_EVALUATOR.FLYWHEEL_METRICS, action.expected_metric)) {
      deferred++
      deferredClients.add(action.client_id)
      continue
    }

    try {
      const didWrite = await processAction(action as ActionRow, windowDays)
      if (didWrite) written++
      else skipped++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Attribution job: action ${action.id} — ${msg}`)
      skipped++
    }
  }

  return {
    processed: actions.length,
    written,
    skipped,
    deferred,
    deferredClientIds: Array.from(deferredClients),
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface ActionRow {
  id: string
  client_id: string
  expected_metric: string
  expected_delta: number | null
  executed_at: string
}

async function processAction(action: ActionRow, windowDays: number): Promise<boolean> {
  const { id, client_id, expected_metric, expected_delta, executed_at } = action
  const executedAt = new Date(executed_at)
  const windowEnd = new Date(executedAt)
  windowEnd.setDate(windowEnd.getDate() + windowDays)

  // ── Baseline: most recent metric BEFORE the action ────────────────────────
  const { data: baselineRow, error: baselineErr } = await supabaseAdmin
    .from('flywheel_metrics')
    .select('metric_value')
    .eq('client_id', client_id)
    .eq('metric_key', expected_metric)
    .lt('measured_at', executedAt.toISOString())
    .order('measured_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (baselineErr) throw new Error(`baseline query: ${baselineErr.message}`)
  if (!baselineRow) return false  // no baseline → skip

  // ── After: most recent metric AFTER action, within window ─────────────────
  const { data: afterRow, error: afterErr } = await supabaseAdmin
    .from('flywheel_metrics')
    .select('metric_value')
    .eq('client_id', client_id)
    .eq('metric_key', expected_metric)
    .gte('measured_at', executedAt.toISOString())
    .lte('measured_at', windowEnd.toISOString())
    .order('measured_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (afterErr) throw new Error(`after query: ${afterErr.message}`)
  if (!afterRow) return false  // too early, no measurement yet

  // ── Compute attribution ───────────────────────────────────────────────────
  const baseline = Number(baselineRow.metric_value)
  const afterValue = Number(afterRow.metric_value)
  const delta = afterValue - baseline
  const deltaPct = baseline !== 0 ? (delta / Math.abs(baseline)) * 100 : null

  const { verdict, confidence } = computeVerdict(delta, deltaPct, expected_delta)

  // ── Upsert on the natural key (action_id, metric_key, window_days) ────────
  //
  // This used to be DELETE WHERE action_id = ? followed by INSERT. That did two
  // damaging things: it changed flywheel_outcomes.id on every 6-hourly run, so
  // nothing downstream could hold a stable reference to the same business
  // outcome; and because the delete was not scoped to this metric, it could
  // wipe the rows the GSC evaluator writes for the same action. See Issue #859.
  const { error: upsertErr } = await supabaseAdmin
    .from('flywheel_outcomes')
    .upsert(
      {
        action_id: id,
        client_id,
        metric_key: expected_metric,
        baseline,
        after_value: afterValue,
        delta,
        delta_pct: deltaPct,
        confidence,
        verdict,
        window_days: windowDays,
        evaluator_key: OUTCOME_EVALUATOR.FLYWHEEL_METRICS,
        computed_at: new Date().toISOString(),
      },
      { onConflict: OUTCOME_CONFLICT_TARGET },
    )

  if (upsertErr) throw new Error(`outcome upsert: ${upsertErr.message}`)

  return true
}

// ── Verdict computation ───────────────────────────────────────────────────────

/**
 * Classify the outcome of an attribution window.
 *
 * Rules:
 *  - |delta_pct| < 3%   → inconclusive (noise floor)
 *  - expected_delta set → direction match = confirmed, mismatch = reversed
 *  - no expected_delta  → positive delta = confirmed, negative = reversed
 *  - confidence ∝ |delta_pct| / 20 (20 % change → full confidence, cap 0.95)
 */
export function computeVerdict(
  delta: number,
  deltaPct: number | null,
  expectedDelta: number | null
): { verdict: OutcomeVerdict; confidence: number } {
  const absPct = deltaPct !== null ? Math.abs(deltaPct) : 0

  if (absPct < 3) {
    return { verdict: 'inconclusive', confidence: 0.2 }
  }

  const confidence = round2(Math.min(0.95, absPct / 20))

  if (expectedDelta !== null && expectedDelta !== 0) {
    const expectedPositive = expectedDelta > 0
    const actualPositive = delta > 0

    if (expectedPositive === actualPositive) {
      return {
        verdict: confidence >= 0.35 ? 'confirmed' : 'inconclusive',
        confidence,
      }
    }
    return { verdict: 'reversed', confidence }
  }

  // No expected direction — use sign of actual delta
  return {
    verdict: delta > 0 ? 'confirmed' : 'reversed',
    confidence: round2(Math.min(0.7, absPct / 20)),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
