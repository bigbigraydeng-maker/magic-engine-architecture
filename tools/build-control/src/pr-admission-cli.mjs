#!/usr/bin/env node
/**
 * CLI entrypoint for `.github/workflows/build-control-admission.yml`.
 *
 * Metadata-only: reads the PR body and the open-PR list from the GitHub API
 * and never checks out the PR head. See `evaluateAdmission` in
 * `pr-admission.mjs` for the actual rules; this file is I/O plus reporting.
 */
import { appendFileSync } from 'node:fs'

import { createGitHubClient } from './github.mjs'
import { evaluateAdmission } from './pr-admission.mjs'

function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
  console.log(text)
}

const token = process.env.GITHUB_TOKEN
const repository = process.env.GITHUB_REPOSITORY
const prNumberRaw = process.env.PR_NUMBER

if (!token || !repository || !prNumberRaw) {
  console.error('GITHUB_TOKEN, GITHUB_REPOSITORY and PR_NUMBER are required')
  process.exit(1)
}

const [owner, repo] = repository.split('/')
const prNumber = Number(prNumberRaw)

try {
  const client = createGitHubClient({ token })
  const [pr, openPullRequests] = await Promise.all([
    client.getPullRequest({ owner, repo, prNumber }),
    client.listOpenPullRequests({ owner, repo }),
  ])

  const { grade, reasons, checks } = evaluateAdmission({ pr, openPullRequests })

  const lines = [
    '## Build Control PR Admission',
    '',
    `- PR: #${pr.number} (created ${pr.createdAt}, draft=${pr.isDraft})`,
    `- Primary-Issue: ${checks.primaryIssue.ok ? `#${checks.primaryIssue.issueNumber}` : checks.primaryIssue.reason}`,
    `- Outcome-Contract: ${checks.outcomeContract.ok ? 'present' : checks.outcomeContract.reason}`,
    `- Duplicate: ${checks.duplicate.claimed ? `claimed also by #${checks.duplicate.byPrNumbers.join(', #')}` : 'none'}`,
    `- Cap: ${checks.cap.reason}`,
    `- Grade: **${grade}**`,
  ]
  if (reasons.length > 0) {
    lines.push('', '### Findings', ...reasons.map((r) => `- ${r}`))
  }
  if (grade === 'LEGACY_TRIAGE_REQUIRED') {
    lines.push(
      '',
      '> 这个 PR 是在本闸门生效前创建的（grandfathered）。它没有被判失败，但上面列的字段确实缺失 —— ' +
        '需要人工 triage，不代表已经合规。'
    )
  }
  summary(lines.join('\n'))

  process.exit(grade === 'FAIL' ? 1 : 0)
} catch (error) {
  summary(`## ❌ Build Control PR Admission：读取 GitHub 事实失败，按失败处理\n\n${error.message}`)
  process.exit(1)
}
