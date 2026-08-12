/**
 * Workflow B entrypoint (ops-codex-to-claude-fix.yml). Runs when Codex
 * submits a review on a qualifying PR. Decides one of:
 *
 *   dispatch-fix  -> the workflow invokes claude-code-action directly with
 *                    the aggregated findings as its prompt, then a separate
 *                    step (mark-fix-outcome.mjs) records success/failure
 *   needs-human   -> post "NEEDS HUMAN REVIEW" and stop (3 rounds already used)
 *   ready         -> post "READY FOR PRODUCT OWNER" (no actionable findings, CI green)
 *   wait-ci       -> no actionable findings, and required CI still hasn't
 *                    gone green after polling within this run
 *   skip          -> this head sha already has a marker for the stage we'd write
 *
 * It never merges, deploys, applies a migration, or resolves a review thread.
 * `plan.mjs` holds the actual decision logic and is unit-tested in isolation;
 * this file is the I/O glue around it.
 */
import { readFileSync } from 'node:fs'
import { createIssueComment, listCheckRunsForRef, listIssueComments, listReviewComments } from './github.mjs'
import { buildMarker, parseMarkers } from './markers.mjs'
import { decideStage } from './plan.mjs'
import { setOutput } from './output.mjs'
import { buildFixPrompt } from './prompt.mjs'
import { waitForRequiredCheck } from './poll.mjs'
import { isActionable } from './severity.mjs'

const MAX_ROUNDS = 3
// Matches the job name in ai-orchestrator-ci.yml ("ai-orchestrator-tests") or
// the workflow name shown in the Checks tab ("ai-orchestrator CI") — whichever
// GitHub surfaces as the check-run `name`.
const REQUIRED_CHECK_NAME_PATTERN = /ai-orchestrator/i
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const token = process.env.GITHUB_TOKEN
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
const pr = event.pull_request.number
const sha = event.pull_request.head.sha
const review = event.review

const [issueComments, reviewComments, initialCheckRuns] = await Promise.all([
  listIssueComments(token, owner, repo, pr),
  listReviewComments(token, owner, repo, pr, review.id),
  listCheckRunsForRef(token, owner, repo, sha),
])

const markers = parseMarkers(issueComments.map((c) => c.body))

const findingCandidates = [
  { source: 'review summary', body: review.body ?? '' },
  ...reviewComments.map((c) => ({ source: `${c.path}:${c.line ?? c.original_line ?? '?'}`, body: c.body ?? '' })),
]
const actionableFindings = findingCandidates.filter((f) => isActionable(f.body))
const hasActionableFindings = actionableFindings.length > 0

function checkSucceeded(run) {
  return run?.status === 'completed' && run?.conclusion === 'success'
}

let requiredCheck = initialCheckRuns.find((run) => REQUIRED_CHECK_NAME_PATTERN.test(run.name))

// Codex finding (PR #906, P2): a clean review that lands while required CI is
// still running used to fall straight through to `wait-ci` and stop there —
// this workflow only fires on pull_request_review.submitted, so CI turning
// green afterward never got re-evaluated for that head sha. Poll within this
// same run (bounded) before giving up, since there is no other event wired to
// retry it.
if (!hasActionableFindings && !checkSucceeded(requiredCheck)) {
  const polled = await waitForRequiredCheck({
    fetchCheckRuns: async () => listCheckRunsForRef(token, owner, repo, sha),
    sleep,
    pattern: REQUIRED_CHECK_NAME_PATTERN,
    maxAttempts: 12,
    intervalMs: 20000,
  })
  if (polled) {
    requiredCheck = polled
  }
}

const ciSuccess = checkSucceeded(requiredCheck)

const plan = decideStage({
  markers,
  sha,
  hasActionableFindings,
  ciSuccess,
  maxRounds: MAX_ROUNDS,
})

switch (plan.action) {
  case 'skip': {
    console.log(`Skipping: ${plan.reason}`)
    setOutput('action', 'skip')
    break
  }
  case 'needs-human': {
    const marker = buildMarker({ stage: 'needs-human', pr, sha, round: plan.round })
    await createIssueComment(
      token,
      owner,
      repo,
      pr,
      `**NEEDS HUMAN REVIEW**\n\nCodex has raised actionable findings for ${MAX_ROUNDS} automated fix rounds without a clean review. Stopping automation here — please review manually.\n\n${marker}`
    )
    setOutput('action', 'needs-human')
    break
  }
  case 'wait-ci': {
    // This used to log and post nothing. Nothing else re-triggers this
    // workflow for the same sha — it only listens to
    // pull_request_review.submitted — so re-running a check to green produces
    // no new event, and the PR simply stopped moving. From the PR page, "CI is
    // red" and "the automation is broken" looked identical: silence, forever.
    //
    // Say which checks are not green, once per sha, and say plainly that a
    // re-run alone will not restart anything.
    // `requiredCheck` is whatever the poll last saw for the gating check; the
    // initial list is everything else on the sha. Report both, so the comment
    // is useful even when the gating check simply never appeared.
    const observed = requiredCheck ? [requiredCheck] : initialCheckRuns
    const notGreen = observed
      .filter((r) => !(r?.status === 'completed' && ['success', 'neutral', 'skipped'].includes(r?.conclusion)))
      .map((r) => `- \`${r.name}\` — ${r.status}${r.conclusion ? `/${r.conclusion}` : ''}`)
    const alreadyTold = markers.some((m) => m.stage === 'ci-blocked' && m.sha === sha)
    if (!alreadyTold) {
      const marker = buildMarker({ stage: 'ci-blocked', pr, sha })
      await createIssueComment(
        token,
        owner,
        repo,
        pr,
        `**BLOCKED ON CI**\n\nCodex raised no actionable findings, but these checks on \`${sha.slice(0, 10)}\` are not green:\n\n${notGreen.join('\n') || '- (no check runs reported at all)'}\n\nNothing re-triggers this automation for the same commit, so re-running a check to green will **not** move this PR on its own — push a commit, or ask Codex to review again once CI is green.\n\n${marker}`
      )
    }
    console.log('No actionable findings, but CI is not green — posted BLOCKED ON CI instead of staying silent.')
    setOutput('action', 'wait-ci')
    break
  }
  case 'ready': {
    const marker = buildMarker({ stage: 'ready', pr, sha })
    await createIssueComment(
      token,
      owner,
      repo,
      pr,
      `**READY FOR PRODUCT OWNER**\n\nCodex reports no actionable P0/P1/P2 findings and required CI is green. This automation never merges — a human must take it from here.\n\n${marker}`
    )
    setOutput('action', 'ready')
    break
  }
  case 'dispatch-fix': {
    // Codex finding (PR #906, P2): this case used to post the fix-dispatched
    // marker itself, before the Claude Action step even ran — so a timeout or
    // failed push still permanently consumed a round. The marker is now
    // posted by mark-fix-outcome.mjs, and only on success.
    const findingsText = actionableFindings
      .map((f, i) => `${i + 1}. [${f.source}]\n${f.body.trim()}`)
      .join('\n\n')
    // The findings block is attacker-influenced text: anyone who can get words
    // into a Codex review body gets those words into a prompt for a run that
    // commits and pushes. Issue #939 required this surface be re-checked
    // before the Codex bot was allowlisted on the action — the fencing and its
    // adversarial tests live in ./prompt.mjs (a script cannot be imported by a
    // test without executing, hence the separate module).
    const prompt = buildFixPrompt({
      round: plan.round,
      maxRounds: MAX_ROUNDS,
      pr,
      findingsText,
    })
    setOutput('action', 'dispatch-fix')
    setOutput('round', String(plan.round))
    setOutput('prompt', prompt)
    break
  }
  default:
    throw new Error(`Unhandled plan action: ${plan.action}`)
}
