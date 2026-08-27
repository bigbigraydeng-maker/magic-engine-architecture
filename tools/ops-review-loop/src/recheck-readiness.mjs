/**
 * Workflow C entrypoint (ops-dev-gate-recheck.yml). Runs whenever any check
 * run in the repository completes. Exists for exactly the gap
 * `handle-review.mjs` (the review-triggered leg) cannot close: a C-level PR
 * `sampling.mjs`'s stable 20% sample did NOT select for Codex review. Nothing
 * then ever fires `pull_request_review.submitted` for it, so without this
 * leg an otherwise-done unsampled C-level PR would sit forever with no READY
 * / BLOCKED verdict — the "skip Codex and nobody ever re-evaluates it"
 * outcome ME2-OPS03 PR2 forbids.
 *
 * Scope is deliberately narrow, and the two legs never race each other:
 *
 *   - This script only acts when the completed check run matches the
 *     required-check name pattern (everything else is ignored immediately).
 *   - For each PR the check run belongs to, it only proceeds when the PR's
 *     current trusted risk rating is C AND the stable sample did not select
 *     it for Codex review (`shouldRequestCodexReview` returning false).
 *   - Every A/B PR, and every sampled C, is left entirely to the
 *     review-triggered leg — a Codex review is either owed (this script
 *     backs off) or not (the review-triggered leg never runs for this sha in
 *     the first place, since nothing ever submits a review for it).
 *
 * Idempotency does not use the `ops-codex-loop:stage=` marker family
 * `plan.mjs` owns (that dedup is specific to the dispatch/round-cap state
 * machine this leg never touches). Instead it checks whether the current
 * trusted `me-dev-gate` marker already carries a `decision` — the same fact
 * `handle-review.mjs`'s `ready` case produces. Since the two legs are
 * mutually exclusive by construction (above), this is enough on its own.
 *
 * Never merges, deploys, applies a migration, or touches production.
 */
import { readFileSync } from 'node:fs'
import { createIssueComment, getPullRequest, listCheckRunsForRef, listIssueComments } from './github.mjs'
import { shouldRequestCodexReview } from './sampling.mjs'
import { isGateCurrent, selectTrustedGateMarkers } from './gate-marker.mjs'
import { buildVerdictComment } from './verdict.mjs'
import { TRUSTED_GATE_AUTHORS } from './trust.mjs'

const REQUIRED_CHECK_NAME_PATTERN = /ai-orchestrator/i

const token = process.env.GITHUB_TOKEN
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
const checkRun = event.check_run

function checkSucceeded(run) {
  return run?.status === 'completed' && run?.conclusion === 'success'
}

function prQualifies(pr) {
  return (
    pr.base?.ref === 'main' &&
    pr.head?.repo?.full_name === `${owner}/${repo}` &&
    typeof pr.head?.ref === 'string' &&
    pr.head.ref.startsWith('claude/') &&
    pr.state === 'open'
  )
}

/** The current trusted rating for this PR's exact base/head, or `null` if there is none. */
async function currentTrustedGate(prNumber, base, sha) {
  const comments = await listIssueComments(token, owner, repo, prNumber)
  const trustedGates = selectTrustedGateMarkers({
    sources: comments.map((c) => ({ author: c.user?.login ?? null, body: c.body })),
    trustedAuthors: TRUSTED_GATE_AUTHORS,
  })
  return trustedGates.find((g) => isGateCurrent(g, { base, head: sha })) ?? null
}

async function evaluateOne(prNumber) {
  const pr = await getPullRequest(token, owner, repo, prNumber)
  if (!prQualifies(pr)) {
    console.log(`PR #${prNumber} does not qualify (base/head/repo/state). Skipping.`)
    return
  }

  const sha = pr.head.sha
  const base = pr.base.sha
  const currentGate = await currentTrustedGate(prNumber, base, sha)
  if (!currentGate) {
    console.log(`PR #${prNumber}: no current trusted risk rating for ${sha} yet. Skipping — the rating leg will catch up on it.`)
    return
  }
  if ('decision' in currentGate) {
    console.log(`PR #${prNumber}: ${sha} already has a readiness decision on record. Skipping (dedup).`)
    return
  }

  const { review, reason } = shouldRequestCodexReview({ risk: currentGate.risk, pr: prNumber, sha })
  if (review) {
    console.log(
      `PR #${prNumber}: ${sha} needs a Codex review (${reason}) — owned by the review-triggered leg, not this one.`,
    )
    return
  }

  const checkRuns = await listCheckRunsForRef(token, owner, repo, sha)
  const requiredCheck = checkRuns.find((run) => REQUIRED_CHECK_NAME_PATTERN.test(run.name))
  const requiredCiPassed = checkSucceeded(requiredCheck)
  if (!requiredCiPassed) {
    console.log(
      `PR #${prNumber}: ${sha} required check is not green yet (${requiredCheck?.status ?? 'not seen'}/${requiredCheck?.conclusion ?? 'n/a'}). Waiting for the next check_run event.`,
    )
    return
  }

  const { decision, comment } = await buildVerdictComment({
    token,
    owner,
    repo,
    prNumber,
    prBody: pr.body,
    base,
    sha,
    risk: currentGate.risk,
    shaMatches: true,
    checkRuns,
    requiredCiPassed,
    // No Codex review was owed for this sha (checked above) — zero
    // outstanding findings by construction, not an assumption.
    openBlockerCount: 0,
  })
  await createIssueComment(token, owner, repo, prNumber, comment)
  console.log(`PR #${prNumber}: posted ${decision.decision} for ${sha} (unsampled C, CI green).`)
}

if (!REQUIRED_CHECK_NAME_PATTERN.test(checkRun?.name ?? '')) {
  console.log(`Check run "${checkRun?.name}" is not the required check. Nothing to do.`)
} else if (checkRun.status !== 'completed') {
  console.log('Check run has not completed yet. Nothing to do.')
} else {
  const candidates = Array.isArray(checkRun.pull_requests) ? checkRun.pull_requests : []
  if (candidates.length === 0) {
    console.log('No associated pull requests on this check run.')
  }
  for (const candidate of candidates) {
    await evaluateOne(candidate.number)
  }
}
