#!/usr/bin/env node
/**
 * CLI entrypoint for `.github/workflows/build-control-1140-guard.yml`.
 *
 * Never edits or deletes the source comment on Issue #1140 — it only adds or
 * removes a label on the Issue itself and writes a job summary, so the
 * failure is machine-visible without touching the payload it is judging.
 */
import { appendFileSync } from 'node:fs'

import { createGitHubClient } from './github.mjs'
import { evaluateControlStateGuard, CONTROL_STATE_INVALID_LABEL } from './issue-1140-guard.mjs'

function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
  console.log(text)
}

const token = process.env.GITHUB_TOKEN
const repository = process.env.GITHUB_REPOSITORY
const issueNumberRaw = process.env.CONTROL_ISSUE_NUMBER

if (!token || !repository || !issueNumberRaw) {
  console.error('GITHUB_TOKEN, GITHUB_REPOSITORY and CONTROL_ISSUE_NUMBER are required')
  process.exit(1)
}

const [owner, repo] = repository.split('/')
const issueNumber = Number(issueNumberRaw)

try {
  const client = createGitHubClient({ token })
  const comments = await client.listIssueComments({ owner, repo, issueNumber })

  const result = evaluateControlStateGuard({ comments })

  if (result.status === 'NO_MARKER') {
    summary(`## ⏭️ Build Control #1140 Guard：无标记\n\n本次评论没有携带 \`ME_CONTROL_STATE_V1\` 标记，跳过。`)
    process.exit(0)
  }

  if (result.status === 'VALID') {
    await client.removeIssueLabel({ owner, repo, issueNumber, name: CONTROL_STATE_INVALID_LABEL })
    summary(`## ✅ Build Control #1140 Guard：通过\n\n最新状态快照（${result.comment.createdAt}）字段完整且新鲜。`)
    process.exit(0)
  }

  await client.addIssueLabel({ owner, repo, issueNumber, name: CONTROL_STATE_INVALID_LABEL })
  summary(
    [
      '## ❌ Build Control #1140 Guard：状态快照不完整或过期',
      '',
      `最新携带标记的评论：${result.comment.createdAt}`,
      '',
      ...result.reasons.map((r) => `- ${r}`),
      '',
      '> 本闸门不会编辑或删除来源评论；已在 Issue 上打标签，供人工/下游消费者识别。',
      '> ⚠️ `chatgpt-codex-connector` 目前拥有原始 Issue 写权限，本仓库代码无法在发布前阻止它张贴无效评论 —— ' +
        'Obsidian 消费端仍是真正拒绝使用不完整 payload 的兜底边界，本闸门只是让问题在这里也可见。',
    ].join('\n')
  )
  process.exit(1)
} catch (error) {
  summary(`## ❌ Build Control #1140 Guard：读取 GitHub 事实失败，按失败处理\n\n${error.message}`)
  process.exit(1)
}
