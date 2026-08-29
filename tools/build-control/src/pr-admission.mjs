/**
 * Pure decision function behind the PR admission workflow
 * (`.github/workflows/build-control-admission.yml`). This is the "catch
 * bypasses outside the dispatcher" layer: the dispatch preflight in
 * `claude.yml` only sees Issue-triggered dispatches, so any PR opened another
 * way (a human, a different automation, `gh pr create`) is validated here
 * instead. A failed check here does not itself stop the PR from existing —
 * that is exactly why the dispatch preflight has to exist too.
 */

import { extractPrimaryIssue } from './primary-issue.mjs'
import { extractOutcomeContract } from './outcome-contract.mjs'
import { isIssueClaimedByOpenPr } from './duplicate-lane.mjs'
import { evaluateCap } from './pr-cap.mjs'
import { applyCutoverGrading } from './legacy-cutover.mjs'

/**
 * @typedef {{ number: number, body: string | null, isDraft?: boolean, createdAt: string }} PullRequestSummary
 */

/**
 * @param {{ pr: PullRequestSummary, openPullRequests: PullRequestSummary[] }} input
 * @returns {{
 *   grade: 'PASS' | 'FAIL' | 'LEGACY_TRIAGE_REQUIRED',
 *   reasons: string[],
 *   checks: {
 *     primaryIssue: ReturnType<typeof extractPrimaryIssue>,
 *     outcomeContract: ReturnType<typeof extractOutcomeContract>,
 *     duplicate: { claimed: boolean, byPrNumbers: number[] },
 *     cap: { blocked: boolean, reason: string },
 *   },
 * }}
 */
export function evaluateAdmission({ pr, openPullRequests }) {
  const primaryIssue = extractPrimaryIssue(pr.body)
  const outcomeContract = extractOutcomeContract(pr.body)
  const duplicate = primaryIssue.ok
    ? isIssueClaimedByOpenPr({
        pullRequests: openPullRequests,
        issueNumber: primaryIssue.issueNumber,
        excludePrNumber: pr.number,
      })
    : { claimed: false, byPrNumbers: [] }
  const cap = evaluateCap({ openPrCount: openPullRequests.length, isNewImplementation: true })

  /** @type {string[]} */
  const reasons = []
  if (!primaryIssue.ok) {
    reasons.push(
      primaryIssue.reason === 'AMBIGUOUS'
        ? 'PR body declares more than one distinct Primary-Issue value'
        : 'PR body is missing an explicit `Primary-Issue: #<number>` field'
    )
  }
  if (!outcomeContract.ok) {
    reasons.push(
      outcomeContract.reason === 'MISSING_SECTION'
        ? 'PR body is missing an `## Outcome-Contract` section'
        : `Outcome-Contract section is missing field(s): ${outcomeContract.missing?.join(', ')}`
    )
  }
  if (duplicate.claimed) {
    reasons.push(
      `Primary-Issue #${primaryIssue.ok ? primaryIssue.issueNumber : '?'} is already claimed by open PR(s) #${duplicate.byPrNumbers.join(', #')}`
    )
  }
  if (cap.blocked) {
    reasons.push(cap.reason)
  }

  const grade = applyCutoverGrading({ createdAt: pr.createdAt, wouldFail: reasons.length > 0 })

  return { grade, reasons, checks: { primaryIssue, outcomeContract, duplicate, cap } }
}
