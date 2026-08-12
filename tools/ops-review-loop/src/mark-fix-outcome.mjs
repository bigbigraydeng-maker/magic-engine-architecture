/**
 * Workflow B (ops-codex-to-claude-fix.yml), step 3 — runs only when
 * handle-review.mjs decided 'dispatch-fix', after the Claude Action step has
 * finished (success or not).
 *
 * Codex finding (PR #906, P2): the previous design wrote the fix-dispatched
 * marker from inside handle-review.mjs, before the Claude Action step even
 * started. A timeout, auth failure, or failed push then still counted as a
 * used round, and decideStage's dedup check (hasMarkerForSha) would skip that
 * same sha forever after — not even a manual re-run of the failed job could
 * recover it, since re-running replays the same event and the marker was
 * already posted.
 *
 * Fix: post the marker ONLY on success. On failure, post a visible warning
 * instead and post no marker — so the next event for the same head sha (a
 * fresh Codex review, or a manual re-run of this same job replaying the
 * original event) sees no fix-dispatched marker yet and retries the same
 * round number rather than either silently stalling or skipping ahead.
 */
import { readFileSync } from 'node:fs'
import { createIssueComment, getPullRequest } from './github.mjs'
import { buildMarker } from './markers.mjs'

const token = process.env.GITHUB_TOKEN
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
const pr = event.pull_request.number
const sha = event.pull_request.head.sha
const round = process.env.ROUND
const outcome = process.env.OUTCOME

// Observed on PR #931 (2026-08-12 04:19, 04:41, 04:51): three rounds each
// exited `success` having pushed nothing, and each announced "pushed the
// change" anyway. Every commit on that branch turned out to be hand-pushed.
// The usual cause is that the findings sit in files the dispatch prompt
// forbids Claude from editing (`.github/workflows/**`, `tools/ai-orchestrator/**`).
//
// A step's exit code is not evidence that a commit exists — only the head sha
// is. Those three rounds also consumed the entire 3-round budget, so the loop
// then declared NEEDS HUMAN REVIEW ("3 rounds without a clean review") about
// work it had never actually attempted.
const headNow = (await getPullRequest(token, owner, repo, pr))?.head?.sha
const pushedSomething = typeof headNow === 'string' && headNow !== sha

if (outcome === 'success' && pushedSomething) {
  const marker = buildMarker({ stage: 'fix-dispatched', pr, sha, round })
  await createIssueComment(
    token,
    owner,
    repo,
    pr,
    `Completed automated fix round ${round} for Codex findings and pushed \`${headNow.slice(0, 10)}\`. Codex will review the new head next.\n\n${marker}`
  )
} else if (outcome === 'success') {
  // Green step, unchanged head. Deliberately writes NO fix-dispatched marker:
  // a round that changed nothing must not consume one of the three, and the
  // findings must not be reported as handled when they are not.
  await createIssueComment(
    token,
    owner,
    repo,
    pr,
    `⚠️ Automated fix round ${round} ran without error but **pushed no commit** — the branch head is still \`${sha.slice(0, 10)}\`, so the Codex findings are **not** addressed.\n\nThe usual cause is findings in files the fix prompt forbids Claude from editing (\`.github/workflows/**\`, \`tools/ai-orchestrator/**\`); those need a human. This round is **not** counted against the 3-round limit.`
  )
} else {
  await createIssueComment(
    token,
    owner,
    repo,
    pr,
    `⚠️ Automated fix round ${round} did not finish successfully (outcome: \`${outcome}\`) — no change was pushed. This round is **not** counted against the 3-round limit; a fresh Codex review on this same head, or a manual re-run of this job, will retry it. Check the workflow run logs if this keeps happening.`
  )
}
