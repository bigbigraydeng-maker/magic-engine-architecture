#!/usr/bin/env node
/**
 * CLI entrypoint for `.github/workflows/build-control-outcome-guard.yml`.
 *
 * Runs on `issues: closed`. If the Issue is labelled `impact-loop` and has no
 * complete, trusted `ME_OUTCOME_RECEIPT_V1`, it reopens the Issue and explains
 * why. A later valid closure removes the incomplete label again, so a stale
 * red mark cannot outlive the problem.
 *
 * Rollout honesty: this creates only its own machine-output label. It never
 * creates or applies `impact-loop` — labelling a business Issue as an IMPACT
 * loop is an owner decision, and an unlabelled Issue is simply out of scope.
 */
import { createGitHubClient } from './github.mjs'
import { IMPACT_INCOMPLETE_LABEL, evaluateBusinessLoopClosure } from './business-loop-guard.mjs'
import { requireAllowlist, requireEnv, splitRepository, summary } from './cli-runtime.mjs'

const env = requireEnv(['GITHUB_TOKEN', 'GITHUB_REPOSITORY', 'ISSUE_NUMBER'])
const allowlist = requireAllowlist('OUTCOME_RECEIPT_ALLOWLIST')
const { owner, repo } = splitRepository(env.GITHUB_REPOSITORY)
const issueNumber = Number(env.ISSUE_NUMBER)

try {
  const client = createGitHubClient({ token: env.GITHUB_TOKEN })
  const [labels, comments] = await Promise.all([
    client.listIssueLabels({ owner, repo, issueNumber }),
    client.listIssueComments({ owner, repo, issueNumber }),
  ])

  const result = evaluateBusinessLoopClosure({ labels, comments, allowlist })

  if (result.status === 'NOT_APPLICABLE') {
    summary(`## ⏭️ Build Control Outcome Guard：不适用\n\nIssue #${issueNumber} 没有 \`impact-loop\` 标签，不要求 Outcome receipt。`)
    process.exit(0)
  }

  if (result.status === 'COMPLETE') {
    await client.removeIssueLabel({ owner, repo, issueNumber, name: IMPACT_INCOMPLETE_LABEL })
    summary(`## ✅ Build Control Outcome Guard：通过\n\nIssue #${issueNumber} 有完整且可信的 ME_OUTCOME_RECEIPT_V1（Execution / Measurement / Outcome / Tune 均为 DONE 且带证据），允许关闭。`)
    process.exit(0)
  }

  await client.setIssueState({ owner, repo, issueNumber, state: 'open' })
  await client.ensureLabelExists({
    owner,
    repo,
    name: IMPACT_INCOMPLETE_LABEL,
    color: 'D93F0B',
    description: 'Build Control: closed without a complete IMPACT Outcome receipt',
  })
  await client.addIssueLabel({ owner, repo, issueNumber, name: IMPACT_INCOMPLETE_LABEL })
  await client.createIssueComment({
    owner,
    repo,
    issueNumber,
    body: [
      '🤖 **Build Control**：这个 Issue 标了 `impact-loop`（业务 IMPACT 闭环），已被自动重新打开。',
      '',
      '工程产出（PR merge / CI 绿 / 执行完成）不等于 IMPACT Outcome。关闭前需要一份由授权人张贴的完整 `ME_OUTCOME_RECEIPT_V1`，' +
        'Execution / Measurement / Outcome / Tune 四段都要是 DONE 且带非空证据：',
      '',
      ...result.reasons.map((r) => `- ${r}`),
    ].join('\n'),
  })
  summary(['## ❌ Build Control Outcome Guard：不完整，已重新打开', '', ...result.reasons.map((r) => `- ${r}`)].join('\n'))
  process.exit(1)
} catch (error) {
  summary(`## ❌ Build Control Outcome Guard：读取 GitHub 事实失败，按失败处理\n\n${error.message}`)
  process.exit(1)
}
