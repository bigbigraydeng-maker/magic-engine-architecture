/**
 * Actions no evaluator can attribute — Issue #859, Codex P1 on PR #862.
 *
 * An action whose `expected_metric` is owned by an evaluator that cannot load
 * its flywheel will never produce an outcome: the owner never sees it, and the
 * `flywheel_outcomes_evaluator_owns_metric` CHECK forbids anyone else writing
 * it. Attribution detects this every run, but a count in a cron summary is not
 * a report — CLAUDE.md §3 is explicit that a finding which cannot be fixed
 * automatically has to reach a human through the same pipeline as everything
 * else, with what / how / href.
 *
 * This audit is the detection half. It reads the same routing rule the writers
 * use, so it cannot disagree with them about which actions are stranded.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import {
  resolveAttributionRoutingDetailed,
  type UnattributableReason,
} from './outcome-identity'

export interface UnattributableAction {
  action_id: string
  client_id: string
  flywheel: string
  expected_metric: string
  action_type: string | null
  executed_at: string | null
  /** Why nobody can attribute it — the three causes have different fixes. */
  reason: UnattributableReason
  /** The metric this action would actually get, when one exists. */
  suggested_metric: string | null
}

interface ActionRow {
  id: string
  client_id: string
  flywheel: string
  action_type: string | null
  payload: Record<string, unknown> | null
  expected_metric: string
  executed_at: string | null
}

/**
 * Every action currently stranded, newest first.
 *
 * Throws on a query failure rather than returning [] — "no stranded actions"
 * and "we could not check" must not look the same to the caller.
 */
export async function auditUnattributableActions(
  supabase: SupabaseClient,
  clientIds?: string[],
): Promise<UnattributableAction[]> {
  // Paginated, not a bare select: PostgREST caps a single response at 1000 rows
  // and says nothing about it. Combined with newest-first ordering, an
  // unpaginated read silently drops the OLDEST actions — and a stranded action
  // only gets older, so precisely the ones most overdue for attention would be
  // the ones that never reach the todo. `fetchAll` throws rather than handing
  // back half a result, which is the whole reason it exists.
  const rows = await fetchAll<ActionRow>((from, to) => {
    let query = supabase
      .from('flywheel_actions')
      .select('id, client_id, flywheel, action_type, payload, expected_metric, executed_at')
      .not('expected_metric', 'is', null)
      // `id` as tiebreak: executed_at is not unique, and an unstable sort across
      // page boundaries duplicates or drops rows there.
      .order('executed_at', { ascending: false })
      .order('id', { ascending: false })

    if (clientIds?.length) query = query.in('client_id', clientIds)

    return query.range(from, to)
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`auditUnattributableActions: ${message}`)
  })

  const stranded: UnattributableAction[] = []

  for (const row of rows) {
    const result = resolveAttributionRoutingDetailed(row)
    if (result.routing !== 'unattributable') continue

    stranded.push({
      action_id: row.id,
      client_id: row.client_id,
      flywheel: row.flywheel,
      expected_metric: row.expected_metric,
      action_type: row.action_type,
      executed_at: row.executed_at,
      reason: result.reason,
      suggested_metric: result.suggestedMetric,
    })
  }

  return stranded
}
