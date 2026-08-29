/**
 * Pure decision function behind `.github/workflows/build-control-admission.yml`.
 *
 * This is the "catch bypasses outside the dispatcher" layer: the dispatch
 * preflight in `claude.yml` only sees Issue-triggered dispatches, so a PR
 * opened another way (a human, a different automation, `gh pr create`) is
 * validated here instead.
 *
 * The cap counts *other* open PRs — the PR being admitted is already open by
 * the time this runs, and counting it would make the cap block the very PR
 * that fills the last permitted slot.
 */

import { extractPrimaryIssue } from './primary-issue.mjs'
import { extractOutcomeContract } from './outcome-contract.mjs'
import { isIssueClaimedByOpenPr } from './duplicate-lane.mjs'
import { evaluateCap } from './pr-cap.mjs'
import { applyCutoverGrading } from './legacy-cutover.mjs'

/**
 * @typedef {{ number: number, body: string | null, isDraft?: boolean, createdAt?: string }} PullRequestSummary
 */

/**
 * @param {{
 *   pr: PullRequestSummary & { createdAt: string },
 *   openPullRequests: PullRequestSummary[],
 *   capOverride?: import('./cap-override.mjs').CapOverrideRecord | null,
 * }} input
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
export function evaluateAdmission({ pr, openPullRequests, capOverride = null }) {
  const others = (Array.isArray(openPullRequests) ? openPullRequests : []).filter((p) => p.number !== pr.number)

  const primaryIssue = extractPrimaryIssue(pr.body)
  const outcomeContract = extractOutcomeContract(pr.body)
  const duplicate = primaryIssue.ok
    ? isIssueClaimedByOpenPr({ pullRequests: others, issueNumber: primaryIssue.issueNumber })
    : { claimed: false, byPrNumbers: [] }
  // The override lifts the cap and nothing else: it is not consulted by any
  // branch below except this one.
  const cap = evaluateCap({ openPrCount: others.length, isNewImplementation: true, override: capOverride })

  /** @type {string[]} */
  const reasons = []
  if (!primaryIssue.ok) {
    reasons.push(
      primaryIssue.reason === 'AMBIGUOUS'
        ? 'PR body declares `Primary-Issue` more than once — exactly one declaration is required'
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
  if (cap.blocked) reasons.push(cap.reason)

  const grade = applyCutoverGrading({ createdAt: pr.createdAt, wouldFail: reasons.length > 0 })
  return { grade, reasons, checks: { primaryIssue, outcomeContract, duplicate, cap } }
}
