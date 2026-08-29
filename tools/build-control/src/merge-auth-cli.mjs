#!/usr/bin/env node
/**
 * CLI entrypoint for `.github/workflows/build-control-merge-auth.yml`.
 *
 * Passes only when the PR's current, full head SHA has a trusted
 * `ME_MERGE_AUTH_V1` comment naming that exact SHA. Re-runs on every push
 * (the head SHA changes, so an old marker stops matching automatically) and
 * on every new issue comment on the PR (so posting the marker itself flips
 * the check without needing a synchronize event).
 *
 * `MERGE_AUTH_ALLOWLIST` is a comma-separated list of GitHub logins trusted
 * to author the marker — repository owner(s), passed in as a workflow env,
 * never hard-coded here so it stays a reviewable piece of workflow
 * configuration rather than buried in library code.
 *
 * A `pull_request` event already produces a natural check tied to its head
 * SHA from the job's own pass/fail exit code, so nothing extra is needed
 * there. An `issue_comment` event (the marker itself being posted, with no
 * new push) does not — GitHub has no head SHA to attach a job-status check
 * to — so `WRITE_EXPLICIT_CHECK=true` makes this script write one explicitly
 * via the Checks API, under the exact same stable name, so posting the
 * marker alone still flips the check without waiting for a synchronize event.
 */
import { appendFileSync } from 'node:fs'

import { createGitHubClient } from './github.mjs'
import { selectTrustedMergeAuthRecords, isMergeAuthorized } from './merge-auth.mjs'

export const CHECK_NAME = 'Build Control Merge Authorisation'

function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
  console.log(text)
}

const token = process.env.GITHUB_TOKEN
const repository = process.env.GITHUB_REPOSITORY
const prNumberRaw = process.env.PR_NUMBER
const allowlistRaw = process.env.MERGE_AUTH_ALLOWLIST ?? ''
const writeExplicitCheck = process.env.WRITE_EXPLICIT_CHECK === 'true'

if (!token || !repository || !prNumberRaw) {
  console.error('GITHUB_TOKEN, GITHUB_REPOSITORY and PR_NUMBER are required')
  process.exit(1)
}

const allowlist = allowlistRaw
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

if (allowlist.length === 0) {
  summary('## ❌ Build Control Merge Authorisation：未配置 allowlist，按失败处理\n\n`MERGE_AUTH_ALLOWLIST` 为空。')
  process.exit(1)
}

const [owner, repo] = repository.split('/')
const prNumber = Number(prNumberRaw)

try {
  const client = createGitHubClient({ token })
  const [pr, comments] = await Promise.all([
    client.getPullRequest({ owner, repo, prNumber }),
    client.listIssueComments({ owner, repo, issueNumber: prNumber }),
  ])

  const records = selectTrustedMergeAuthRecords({ comments, allowlist })
  const decision = isMergeAuthorized({ records, prNumber, currentHeadSha: pr.headSha })

  const passSummary = decision.authorized
    ? `PR #${prNumber} head \`${pr.headSha}\` 由 ${decision.record.authorized_by} 于 ${decision.record.authorized_at} 授权。`
    : `${decision.reason}\n\n当前 head：\`${pr.headSha}\`。推送会自动使旧授权失效（授权按 exact SHA 绑定），需要针对这个新 SHA 重新授权。`

  if (writeExplicitCheck) {
    await client.createCheckRun({
      owner,
      repo,
      headSha: pr.headSha,
      name: CHECK_NAME,
      conclusion: decision.authorized ? 'success' : 'failure',
      summary: passSummary,
    })
  }

  summary(`## ${decision.authorized ? '✅' : '❌'} ${CHECK_NAME}\n\n${passSummary}`)
  process.exit(decision.authorized ? 0 : 1)
} catch (error) {
  summary(`## ❌ ${CHECK_NAME}：读取 GitHub 事实失败，按失败处理\n\n${error.message}`)
  process.exit(1)
}
