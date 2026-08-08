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
import { resolveAttributionRouting } from './outcome-identity'

export interface UnattributableAction {
  action_id: string
  client_id: string
  flywheel: string
  expected_metric: string
  action_type: string | null
  executed_at: string | null
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
  let query = supabase
    .from('flywheel_actions')
    .select('id, client_id, flywheel, action_type, payload, expected_metric, executed_at')
    .not('expected_metric', 'is', null)
    .order('executed_at', { ascending: false })

  if (clientIds?.length) query = query.in('client_id', clientIds)

  const { data, error } = await query
  if (error) {
    throw new Error(`auditUnattributableActions: ${error.message}`)
  }

  return ((data ?? []) as ActionRow[])
    .filter(row => resolveAttributionRouting(row) === 'unattributable')
    .map(row => ({
      action_id: row.id,
      client_id: row.client_id,
      flywheel: row.flywheel,
      expected_metric: row.expected_metric,
      action_type: row.action_type,
      executed_at: row.executed_at,
    }))
}
