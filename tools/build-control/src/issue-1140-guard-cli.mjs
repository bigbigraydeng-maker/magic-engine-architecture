#!/usr/bin/env node
/**
 * CLI entrypoint for `.github/workflows/build-control-1140-guard.yml`.
 *
 * Never edits or deletes the source comment on Issue #1140 — it only adds or
 * removes this system's own label and writes a job summary, so an invalid or
 * untrusted state is machine-visible without touching the payload it judges,
 * and without touching Obsidian or its syncer in any way.
 */
import { createGitHubClient } from './github.mjs'
import { CONTROL_STATE_INVALID_LABEL, evaluateControlStateGuard } from './issue-1140-guard.mjs'
import { requireAllowlist, requireEnv, splitRepository, summary } from './cli-runtime.mjs'

const env = requireEnv(['GITHUB_TOKEN', 'GITHUB_REPOSITORY', 'CONTROL_ISSUE_NUMBER'])
const writerAllowlist = requireAllowlist('CONTROL_STATE_WRITER_ALLOWLIST')
const { owner, repo } = splitRepository(env.GITHUB_REPOSITORY)
const issueNumber = Number(env.CONTROL_ISSUE_NUMBER)

try {
  const client = createGitHubClient({ token: env.GITHUB_TOKEN })
  const comments = await client.listIssueComments({ owner, repo, issueNumber })
  const result = evaluateControlStateGuard({ comments, writerAllowlist })

  if (result.status === 'NO_MARKER') {
    summary('## ⏭️ Build Control #1140 Guard：无标记\n\n没有找到 `ME_CONTROL_STATE_V1` 状态块，跳过。')
    process.exit(0)
  }

  if (result.status === 'VALID') {
    await client.removeIssueLabel({ owner, repo, issueNumber, name: CONTROL_STATE_INVALID_LABEL })
    summary(`## ✅ Build Control #1140 Guard：通过\n\n最新状态快照（${result.comment.createdAt}，作者 ${result.comment.author}）字段完整且新鲜。`)
    process.exit(0)
  }

  await client.ensureLabelExists({
    owner,
    repo,
    name: CONTROL_STATE_INVALID_LABEL,
    color: 'B60205',
    description: 'Build Control: latest ME_CONTROL_STATE_V1 snapshot is invalid or untrusted',
  })
  await client.addIssueLabel({ owner, repo, issueNumber, name: CONTROL_STATE_INVALID_LABEL })
  summary(
    [
      `## ❌ Build Control #1140 Guard：${result.status === 'UNTRUSTED' ? '来源不可信' : '状态快照不完整或过期'}`,
      '',
      `最新携带状态块的评论：${result.comment.createdAt}（作者 ${result.comment.author ?? '未知'}）`,
      '',
      ...result.reasons.map((r) => `- ${r}`),
      '',
      '> 本闸门不会编辑或删除来源评论，也不会改动 Obsidian 或其同步器；只在 Issue 上打机器标签。',
      '> ⚠️ `chatgpt-codex-connector` 目前拥有原始 Issue 写权限，本仓库代码无法在发布前阻止它张贴无效评论 —— ' +
        'Obsidian 消费端仍是真正拒绝使用不完整 payload 的兜底边界，本闸门只是让问题在这里也可见。',
    ].join('\n')
  )
  process.exit(1)
} catch (error) {
  summary(`## ❌ Build Control #1140 Guard：读取 GitHub 事实失败，按失败处理\n\n${error.message}`)
  process.exit(1)
}
