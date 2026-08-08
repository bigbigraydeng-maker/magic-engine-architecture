/**
 * Which outcome represents an action on the execution board — Issue #859.
 *
 * Lifted out of the execution route so it can be tested directly: the route
 * itself is a large handler with a lot of unrelated fan-out, and a rule about
 * "which of an action's rows the reader sees" deserves its own coverage rather
 * than being reachable only through the whole endpoint.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { keepOneCasePerAction } from '@/lib/flywheel/attribution/outcome-identity'

export interface ItemOutcomeSummary {
  verdict: 'confirmed' | 'reversed' | 'inconclusive'
  metric_key: string
  delta: number | null
  delta_pct: number | null
  confidence: number
  computed_at: string
}

interface OutcomeJoin {
  action_id: string
  metric_key: string
  window_days: number | null
  delta: number | null
  delta_pct: number | null
  confidence: number
  verdict: string
  computed_at: string
  flywheel_actions?: { expected_metric: string | null } | { expected_metric: string | null }[]
}

/**
 * One outcome per action, chosen to REPRESENT the action rather than to be the
 * most recently written.
 *
 * "Most recent computed_at" was not a choice at all: the three `seo.gsc.*` rows
 * land in one upsert and share a timestamp, so it picked among them by row
 * order. With ATTRIBUTION_DUAL_WINDOW_ENABLED on it becomes actively wrong —
 * the bridge writes the cadence window first and the handoff window second, so
 * the board would show whichever window happened to be written last rather than
 * the action's own answer.
 *
 * `keepOneCasePerAction` prefers the metric the action actually promised, then
 * the most mature window, so an action shows the same verdict here as it
 * contributes to the benchmarks and the confidence readers.
 * (Codex P2, round 26 on PR #862.)
 */
export async function fetchLatestOutcomesByAction(
  actionIds: string[],
): Promise<Record<string, ItemOutcomeSummary>> {
  if (actionIds.length === 0) return {}

  const { data: outcomeRows } = await supabaseAdmin
    .from('flywheel_outcomes')
    .select(
      'action_id, metric_key, window_days, delta, delta_pct, confidence, verdict, computed_at, ' +
      'flywheel_actions!inner(expected_metric)',
    )
    .in('action_id', actionIds)
    .order('computed_at', { ascending: false })

  const representative = keepOneCasePerAction(
    ((outcomeRows as unknown as OutcomeJoin[]) ?? []).map(r => {
      const a = Array.isArray(r.flywheel_actions) ? r.flywheel_actions[0] : r.flywheel_actions
      return { ...r, expected_metric: a?.expected_metric ?? null }
    }),
  )

  const outcomeByAction: Record<string, ItemOutcomeSummary> = {}
  for (const row of representative) {
    outcomeByAction[row.action_id] = {
      verdict: row.verdict as ItemOutcomeSummary['verdict'],
      metric_key: row.metric_key,
      delta: row.delta,
      delta_pct: row.delta_pct,
      confidence: row.confidence,
      computed_at: row.computed_at,
    }
  }

  return outcomeByAction
}
