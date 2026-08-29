/**
 * Business-loop closure guard.
 *
 * Scope is deliberately narrow: only Issues explicitly labelled `impact-loop`.
 * An ordinary engineering Issue or a merged PR never needs an external Outcome
 * receipt, and gating those would be exactly the "CI green / merge / execution
 * receipt equals Outcome" confusion Issue #1249 forbids.
 *
 * Applying `impact-loop` to a business Issue is an owner rollout action, not
 * something this code does — an unlabelled Issue is simply NOT_APPLICABLE.
 */

import { OUTCOME_RECEIPT_MARKER, isImpactComplete, selectTrustedOutcomeReceipts } from './outcome-receipt.mjs'

export const IMPACT_LOOP_LABEL = 'impact-loop'
export const IMPACT_INCOMPLETE_LABEL = 'build-control:impact-incomplete'

/**
 * @typedef {{ status: 'NOT_APPLICABLE' }} NotApplicable
 * @typedef {{ status: 'COMPLETE' }} LoopComplete
 * @typedef {{ status: 'INCOMPLETE', reasons: string[] }} LoopIncomplete
 */

/**
 * @param {{
 *   labels: string[],
 *   comments: Array<{ author?: string | null, body?: string | null }>,
 *   allowlist: Iterable<string>,
 * }} input
 * @returns {NotApplicable | LoopComplete | LoopIncomplete}
 */
export function evaluateBusinessLoopClosure({ labels, comments, allowlist }) {
  if (!Array.isArray(labels) || !labels.includes(IMPACT_LOOP_LABEL)) return { status: 'NOT_APPLICABLE' }

  const { trusted, rejected } = selectTrustedOutcomeReceipts({ comments, allowlist })
  if (trusted.length === 0) {
    return {
      status: 'INCOMPLETE',
      reasons: [
        `no ${IMPACT_LOOP_LABEL} Issue may close without a trusted ${OUTCOME_RECEIPT_MARKER}, and none was found`,
        ...rejected,
      ],
    }
  }

  // Last one wins — a later, more complete receipt supersedes an earlier
  // partial one for the same loop.
  const result = isImpactComplete(trusted[trusted.length - 1])
  return result.complete ? { status: 'COMPLETE' } : { status: 'INCOMPLETE', reasons: result.reasons }
}
