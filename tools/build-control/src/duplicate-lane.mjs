/**
 * Duplicate-lane detection: two open PRs (PR #1007 and PR #1243 were the
 * live incident) declaring the same `Primary-Issue` with disjoint files pass
 * git conflict detection and ordinary CI cleanly, because nothing about the
 * files overlaps. The only signal that catches it is the shared declaration.
 *
 * Draft PRs count as open duplicates deliberately — GitHub's own "open" state
 * already includes Draft, and a Draft is exactly the state a real duplicate
 * implementation sits in for most of its life.
 */

import { extractPrimaryIssue } from './primary-issue.mjs'

/**
 * @typedef {{ number: number, body: string | null, isDraft?: boolean, state?: string }} PullRequestSummary
 */

/**
 * @param {PullRequestSummary[]} pullRequests open PRs only — callers must
 *   already have filtered to `state: 'open'` (Draft included).
 * @returns {Map<number, number[]>} primary-issue number -> PR numbers, for
 *   every primary issue declared by 2 or more open PRs.
 */
export function findDuplicatePrimaryIssues(pullRequests) {
  /** @type {Map<number, number[]>} */
  const byIssue = new Map()

  for (const pr of Array.isArray(pullRequests) ? pullRequests : []) {
    const result = extractPrimaryIssue(pr?.body)
    if (!result.ok) continue
    const list = byIssue.get(result.issueNumber) ?? []
    list.push(pr.number)
    byIssue.set(result.issueNumber, list)
  }

  for (const [issueNumber, prs] of [...byIssue.entries()]) {
    if (prs.length < 2) byIssue.delete(issueNumber)
  }
  return byIssue
}

/**
 * Is `issueNumber` already claimed by an open PR other than `excludePrNumber`?
 * Used by the dispatch preflight, which runs *before* a PR exists for this
 * dispatch, so there is nothing of "this PR's own" to exclude in that case —
 * `excludePrNumber` is for the PR-admission check re-validating a PR that
 * already declares the issue it is itself allowed to claim.
 *
 * @param {{ pullRequests: PullRequestSummary[], issueNumber: number, excludePrNumber?: number | null }} input
 * @returns {{ claimed: boolean, byPrNumbers: number[] }}
 */
export function isIssueClaimedByOpenPr({ pullRequests, issueNumber, excludePrNumber = null }) {
  const claimants = (Array.isArray(pullRequests) ? pullRequests : [])
    .filter((pr) => pr.number !== excludePrNumber)
    .filter((pr) => {
      const result = extractPrimaryIssue(pr?.body)
      return result.ok && result.issueNumber === issueNumber
    })
    .map((pr) => pr.number)

  return { claimed: claimants.length > 0, byPrNumbers: claimants }
}
