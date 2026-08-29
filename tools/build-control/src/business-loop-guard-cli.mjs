#!/usr/bin/env node
/**
 * CLI entrypoint for `.github/workflows/build-control-outcome-guard.yml`.
 *
 * Runs on `issues: closed`. If the Issue is labelled `impact-loop` and has no
 * complete `ME_OUTCOME_RECEIPT_V1` marker (Measurement + Outcome + Tune all
 * DONE), it reopens the Issue and leaves a comment explaining why — reopening
 * is reversible and narrowly scoped to this one label, so it is not treated
 * as an irreversible action requiring separate authorisation.
 *
 * Issues without the `impact-loop` label, and ordinary merged-PR-driven
 * closures, are left alone entirely.
 */
import { appendFileSync } from 'node:fs'

import { createGitHubClient } from './github.mjs'
import { evaluateBusinessLoopClosure, IMPACT_INCOMPLETE_LABEL } from './business-loop-guard.mjs'

function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
  console.log(text)
}

const token = process.env.GITHUB_TOKEN
const repository = process.env.GITHUB_REPOSITORY
const issueNumberRaw = process.env.ISSUE_NUMBER

if (!token || !repository || !issueNumberRaw) {
  console.error('GITHUB_TOKEN, GITHUB_REPOSITORY and ISSUE_NUMBER are required')
  process.exit(1)
}

const [owner, repo] = repository.split('/')
const issueNumber = Number(issueNumberRaw)

try {
  const client = createGitHubClient({ token })
  const [labels, comments] = await Promise.all([
    client.listIssueLabels({ owner, repo, issueNumber }),
    client.listIssueComments({ owner, repo, issueNumber }),
  ])

  const result = evaluateBusinessLoopClosure({ labels, comments })

  if (result.status === 'NOT_APPLICABLE') {
    summary(`## ⏭️ Build Control Outcome Guard：不适用\n\nIssue #${issueNumber} 没有 \`impact-loop\` 标签，不要求 Outcome receipt。`)
    process.exit(0)
  }

  if (result.status === 'COMPLETE') {
    summary(`## ✅ Build Control Outcome Guard：通过\n\nIssue #${issueNumber} 有完整的 ME_OUTCOME_RECEIPT_V1（Measurement + Outcome + Tune 均为 DONE），允许关闭。`)
    process.exit(0)
  }

  await client.setIssueState({ owner, repo, issueNumber, state: 'open' })
  await client.addIssueLabel({ owner, repo, issueNumber, name: IMPACT_INCOMPLETE_LABEL })
  await client.createIssueComment({
    owner,
    repo,
    issueNumber,
    body: [
      '🤖 **Build Control**：这个 Issue 标了 `impact-loop`（业务 IMPACT 闭环），已被自动重新打开。',
      '',
      '工程产出（PR merge / CI 绿 / 执行完成）不等于 IMPACT Outcome。关闭前需要一份完整的 `ME_OUTCOME_RECEIPT_V1`，' +
        'Measurement / Outcome / Tune 三段都要是 DONE：',
      '',
      ...result.reasons.map((r) => `- ${r}`),
    ].join('\n'),
  })
  summary(
    [
      '## ❌ Build Control Outcome Guard：不完整，已重新打开',
      '',
      ...result.reasons.map((r) => `- ${r}`),
    ].join('\n')
  )
  process.exit(1)
} catch (error) {
  summary(`## ❌ Build Control Outcome Guard：读取 GitHub 事实失败，按失败处理\n\n${error.message}`)
  process.exit(1)
}
