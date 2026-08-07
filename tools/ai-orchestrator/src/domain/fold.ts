/**
 * Derives the current run from the ledger.
 *
 * The ledger is the record; this fold is the only way run state is computed.
 * Keeping no second copy is what makes a re-dispatched workflow safe: it reads
 * the same events and lands on the same state instead of replaying work.
 */

import type { LedgerEvent, OrchestrationRun } from './schema'

export function foldRun(
  initial: OrchestrationRun,
  events: readonly LedgerEvent[],
  lastCommentId: number | null
): OrchestrationRun {
  let run: OrchestrationRun = { ...initial, last_processed_comment_id: lastCommentId }

  for (const event of events) {
    if (event.run_id !== initial.run_id) continue

    switch (event.event) {
      case 'turn_completed':
        run = {
          ...run,
          state: event.next_state,
          current_round: Math.max(run.current_round, event.round),
          cumulative_cost_usd: run.cumulative_cost_usd + event.cost_usd,
        }
        break
      case 'turn_rejected':
        run = {
          ...run,
          state: event.next_state,
          current_round: Math.max(run.current_round, event.round),
          invalid_output_count:
            run.invalid_output_count + (event.reason === 'invalid_output' ? 1 : 0),
        }
        break
      case 'state_changed':
        run = { ...run, state: event.to }
        break
      case 'run_finished':
        run = { ...run, state: event.final_state, stop_reason: event.stop_reason }
        break
      default:
        break
    }
  }

  return run
}
