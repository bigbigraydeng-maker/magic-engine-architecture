#!/usr/bin/env node
/**
 * CLI entrypoint for `.github/workflows/build-control-admission.yml`.
 *
 * Metadata-only: reads the PR body, the open-PR list and the PR's own comments
 * (for a cap override) from the GitHub API. It never checks out or executes
 * PR-head code — the workflow checks out `main`, so a PR cannot edit the guard
 * that judges it.
 *
 * The result is written as an explicit check run against the PR's current full
 * head SHA, because the job's own status attaches to the base branch under
 * `pull_request_target` and would therefore never report on the code being
 * merged. The check run is written on the error path too: a run that cannot
 * reach GitHub must leave a red check, not silence.
 */
import { createGitHubClient } from './github.mjs'
import { evaluateAdmission } from './pr-admission.mjs'
import { selectCapOverride } from './cap-override.mjs'
import { extractPrimaryIssue } from './primary-issue.mjs'
import { requireAllowlist, requireEnv, splitRepository, summary } from './cli-runtime.mjs'
import { ADMISSION_CHECK_NAME as CHECK_NAME } from './check-names.mjs'

const env = requireEnv(['GITHUB_TOKEN', 'GITHUB_REPOSITORY', 'PR_NUMBER', 'PR_HEAD_SHA'])
const allowlist = requireAllowlist('CAP_OVERRIDE_ALLOWLIST')
const { owner, repo } = splitRepository(env.GITHUB_REPOSITORY)
const prNumber = Number(env.PR_NUMBER)

const client = createGitHubClient({ token: env.GITHUB_TOKEN })

/** @param {'success' | 'failure'} conclusion @param {string} headSha @param {string} text */
async function report(conclusion, headSha, text) {
  summary(`## ${conclusion === 'success' ? '✅' : '❌'} ${CHECK_NAME}\n\n${text}`)
  await client.createCheckRun({ owner, repo, headSha, name: CHECK_NAME, conclusion, title: CHECK_NAME, summary: text })
}

try {
  const [pr, openPullRequests, comments] = await Promise.all([
    client.getPullRequest({ owner, repo, prNumber }),
    client.listOpenPullRequests({ owner, repo }),
    client.listIssueComments({ owner, repo, issueNumber: prNumber }),
  ])

  // The event's head SHA is what the check must attach to; if the PR has moved
  // on since the event fired, this run is judging a SHA that no longer exists
  // and a fresher run is already queued for the new one.
  if (pr.headSha !== env.PR_HEAD_SHA) {
    await report(
      'failure',
      env.PR_HEAD_SHA,
      `PR #${prNumber} 的 head 已从 \`${env.PR_HEAD_SHA}\` 移动到 \`${pr.headSha}\`，本次判定作废，等待新 head 的检查。`
    )
    process.exit(1)
  }

  const declared = extractPrimaryIssue(pr.body)
  const override = declared.ok
    ? selectCapOverride({ comments, allowlist, issueNumber: declared.issueNumber, now: new Date() })
    : { granted: false, reason: 'no single Primary-Issue to bind an override to' }

  const { grade, reasons, checks } = evaluateAdmission({
    pr,
    openPullRequests,
    capOverride: override.granted ? override.record : null,
  })

  const lines = [
    `- PR #${pr.number}（created ${pr.createdAt}, draft=${pr.isDraft}, head \`${pr.headSha}\`）`,
    `- Primary-Issue: ${checks.primaryIssue.ok ? `#${checks.primaryIssue.issueNumber}` : checks.primaryIssue.reason}`,
    `- Outcome-Contract: ${checks.outcomeContract.ok ? 'present' : checks.outcomeContract.reason}`,
    `- Duplicate: ${checks.duplicate.claimed ? `also claimed by #${checks.duplicate.byPrNumbers.join(', #')}` : 'none'}`,
    `- Cap: ${checks.cap.reason}`,
    `- Grade: **${grade}**`,
  ]
  if (reasons.length > 0) lines.push('', '### Findings', ...reasons.map((r) => `- ${r}`))
  if (grade === 'LEGACY_TRIAGE_REQUIRED') {
    lines.push(
      '',
      '> 这个 PR 建于本闸门生效前（grandfathered）。它没有被判失败，但上面列的字段确实缺失 —— 需要人工 triage，不代表已经合规。'
    )
  }

  await report(grade === 'FAIL' ? 'failure' : 'success', pr.headSha, lines.join('\n'))
  process.exit(grade === 'FAIL' ? 1 : 0)
} catch (error) {
  await report('failure', env.PR_HEAD_SHA, `读取 GitHub 事实失败，按失败处理：\n\n${error.message}`).catch(() => {})
  process.exit(1)
}
