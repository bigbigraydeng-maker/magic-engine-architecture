/**
 * Pure decision function behind the business-loop closure guard.
 *
 * Scope is deliberately narrow: this only applies to Issues explicitly
 * labelled `impact-loop` (a business IMPACT loop per CLAUDE.md's
 * Inspect → Measure → Prescribe → Act → Check → Tune). An ordinary
 * engineering Issue or a merged PR never needs an external Outcome receipt —
 * gating those would be exactly the "CI green / merge / execution receipt
 * equals Outcome" confusion Issue #1249 forbids.
 */

import { findOutcomeReceiptMarkers, isImpactComplete } from './outcome-receipt.mjs'

export const IMPACT_LOOP_LABEL = 'impact-loop'
export const IMPACT_INCOMPLETE_LABEL = 'build-control:impact-incomplete'

/**
 * @param {{ labels: string[], comments: Array<{ body: string }> }} input
 * @returns {
 *   | { status: 'NOT_APPLICABLE' }
 *   | { status: 'COMPLETE' }
 *   | { status: 'INCOMPLETE', reasons: string[] }
 * }
 */
export function evaluateBusinessLoopClosure({ labels, comments }) {
  if (!Array.isArray(labels) || !labels.includes(IMPACT_LOOP_LABEL)) {
    return { status: 'NOT_APPLICABLE' }
  }

  const markers = (Array.isArray(comments) ? comments : []).flatMap((c) => findOutcomeReceiptMarkers(c.body))
  if (markers.length === 0) {
    return { status: 'INCOMPLETE', reasons: [`no ${IMPACT_LOOP_LABEL} Issue may close without a ME_OUTCOME_RECEIPT_V1 marker, and none was found`] }
  }

  // Last one wins, same rule as every other marker reader here — a later,
  // more complete receipt supersedes an earlier partial one for the same loop.
  const latest = markers[markers.length - 1]
  const result = isImpactComplete(latest)
  return result.complete ? { status: 'COMPLETE' } : { status: 'INCOMPLETE', reasons: result.reasons }
}
