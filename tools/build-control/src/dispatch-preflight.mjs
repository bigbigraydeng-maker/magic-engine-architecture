/**
 * Pure decision function behind the Claude dispatch preflight
 * (`.github/workflows/claude.yml`). Kept separate from the CLI/I-O wrapper so
 * it can be unit-tested without mocking `fetch`.
 *
 * The three blocking conditions from Issue #1249 §2, in order:
 *   1. another open PR (Draft included) already declares this `Primary-Issue`;
 *   2. the repository is at/above the recovery cap of 12 open PRs;
 *   3. a lane is already active for this exact Issue (a second dispatch
 *      racing the first, before either has opened a PR yet — the duplicate
 *      check alone cannot catch this because there is no PR yet to compare).
 *
 * None of this runs at all for a comment on an *existing* PR — that path is
 * gated by `isNewImplementationDispatch`, decided by the caller from the
 * triggering GitHub event, not by anything in this module.
 */

import { isIssueClaimedByOpenPr } from './duplicate-lane.mjs'
import { evaluateCap } from './pr-cap.mjs'

/**
 * @param {{
 *   isNewImplementationDispatch: boolean,
 *   issueNumber: number | null,
 *   openPullRequests: Array<{ number: number, body: string | null, isDraft?: boolean }>,
 *   activeLaneIssueNumbers?: number[],
 * }} input
 * @returns {{ blocked: boolean, reasons: string[] }}
 */
export function evaluateDispatchPreflight({
  isNewImplementationDispatch,
  issueNumber,
  openPullRequests,
  activeLaneIssueNumbers = [],
}) {
  if (!isNewImplementationDispatch) {
    return { blocked: false, reasons: ['not a new implementation dispatch — preflight does not apply'] }
  }
  if (typeof issueNumber !== 'number') {
    return { blocked: true, reasons: ['could not determine the triggering Issue number — failing closed'] }
  }

  const reasons = []

  const claim = isIssueClaimedByOpenPr({ pullRequests: openPullRequests, issueNumber })
  if (claim.claimed) {
    reasons.push(
      `Issue #${issueNumber} is already declared as Primary-Issue by open PR(s) #${claim.byPrNumbers.join(', #')}`
    )
  }

  const cap = evaluateCap({ openPrCount: openPullRequests.length, isNewImplementation: true })
  if (cap.blocked) {
    reasons.push(cap.reason)
  }

  if (activeLaneIssueNumbers.includes(issueNumber)) {
    reasons.push(`Issue #${issueNumber} already has an active dispatch lane (concurrent dispatch race)`)
  }

  return { blocked: reasons.length > 0, reasons }
}
