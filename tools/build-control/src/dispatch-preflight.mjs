/**
 * Pure decision function behind the Claude dispatch preflight in
 * `.github/workflows/claude.yml`. Kept separate from the CLI/I-O wrapper so it
 * can be unit-tested without mocking `fetch`.
 *
 * Two blocking conditions:
 *   1. another open PR (Draft included) already declares this `Primary-Issue`;
 *   2. admitting this lane would push the repository past the recovery cap.
 *
 * There is deliberately no "active lane" list parameter. The race it would
 * describe — two dispatches for the same Issue landing before either has
 * opened a PR — is closed by the single global `concurrency:` group in
 * claude.yml, which serialises *all* new-implementation dispatches; a caller
 * with no way to observe in-flight runs would have had to pass a permanently
 * empty array, which reads like a working check and is not one.
 *
 * None of this runs for a comment on an *existing* PR: that path is gated by
 * `isNewImplementationDispatch`, decided by the caller from the triggering
 * GitHub event.
 */

import { isIssueClaimedByOpenPr } from './duplicate-lane.mjs'
import { evaluateCap } from './pr-cap.mjs'

/**
 * @param {{
 *   isNewImplementationDispatch: boolean,
 *   issueNumber: number | null,
 *   openPullRequests: Array<{ number: number, body: string | null, isDraft?: boolean }>,
 *   capOverride?: import('./cap-override.mjs').CapOverrideRecord | null,
 * }} input `openPullRequests` is the pre-creation count — no PR exists yet for
 *   the lane being judged.
 * @returns {{ blocked: boolean, reasons: string[] }}
 */
export function evaluateDispatchPreflight({
  isNewImplementationDispatch,
  issueNumber,
  openPullRequests,
  capOverride = null,
}) {
  if (!isNewImplementationDispatch) {
    return { blocked: false, reasons: ['not a new implementation dispatch — preflight does not apply'] }
  }
  if (typeof issueNumber !== 'number' || !Number.isFinite(issueNumber)) {
    return { blocked: true, reasons: ['could not determine the triggering Issue number — failing closed'] }
  }

  /** @type {string[]} */
  const reasons = []

  const claim = isIssueClaimedByOpenPr({ pullRequests: openPullRequests, issueNumber })
  if (claim.claimed) {
    reasons.push(
      `Issue #${issueNumber} is already declared as Primary-Issue by open PR(s) #${claim.byPrNumbers.join(', #')}`
    )
  }

  const cap = evaluateCap({
    openPrCount: (openPullRequests ?? []).length,
    isNewImplementation: true,
    override: capOverride,
  })
  if (cap.blocked) reasons.push(cap.reason)

  return { blocked: reasons.length > 0, reasons }
}
