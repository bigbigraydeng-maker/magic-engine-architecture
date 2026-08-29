#!/usr/bin/env node
/**
 * CLI entrypoint for the Claude dispatch preflight in
 * `.github/workflows/claude.yml`. The `claude` job — the one that spends a
 * model call — requires this job to have succeeded with `blocked=false`.
 *
 * Fails closed: any error reading GitHub facts (auth, network, pagination)
 * exits non-zero, and the `claude` job's `if:` requires
 * `needs.dispatch-preflight.result == 'success'`, so "we could not check"
 * blocks exactly like "we checked and it is blocked". Zero model calls happen
 * on either path, because both stop before the `claude` job can start.
 *
 * The same-Issue dispatch race is closed by the single global `concurrency:`
 * group in claude.yml, which serialises every new-implementation dispatch;
 * this script does not pretend to observe in-flight runs.
 */
import { createGitHubClient } from './github.mjs'
import { evaluateDispatchPreflight } from './dispatch-preflight.mjs'
import { selectCapOverride } from './cap-override.mjs'
import { requireAllowlist, requireEnv, setOutput, splitRepository, summary } from './cli-runtime.mjs'

const isNewImplementationDispatch = process.env.IS_NEW_IMPLEMENTATION_DISPATCH === 'true'

if (!isNewImplementationDispatch) {
  setOutput('blocked', 'false')
  summary('## ⏭️ Build Control dispatch preflight：不适用\n\n本次触发不是新的 Issue 派发（例如 PR 复审 / 整改评论），不受重复检测与 cap 约束。')
  process.exit(0)
}

const env = requireEnv(['GITHUB_TOKEN', 'GITHUB_REPOSITORY'])
const allowlist = requireAllowlist('CAP_OVERRIDE_ALLOWLIST')
const { owner, repo } = splitRepository(env.GITHUB_REPOSITORY)
const issueNumber = process.env.ISSUE_NUMBER ? Number(process.env.ISSUE_NUMBER) : null

try {
  const client = createGitHubClient({ token: env.GITHUB_TOKEN })
  const openPullRequests = await client.listOpenPullRequests({ owner, repo })
  const comments =
    issueNumber === null ? [] : await client.listIssueComments({ owner, repo, issueNumber })
  const override =
    issueNumber === null
      ? { granted: false }
      : selectCapOverride({ comments, allowlist, issueNumber, now: new Date() })

  const result = evaluateDispatchPreflight({
    isNewImplementationDispatch,
    issueNumber,
    openPullRequests,
    capOverride: override.granted ? override.record : null,
  })

  setOutput('blocked', String(result.blocked))
  summary(
    result.blocked
      ? [`## ❌ Build Control dispatch preflight：拦截`, '', `Issue #${issueNumber} 的派发被拦截，Claude 不会被调用：`, '', ...result.reasons.map((r) => `- ${r}`)].join('\n')
      : `## ✅ Build Control dispatch preflight：通过\n\nIssue #${issueNumber}，当前 ${openPullRequests.length} 个开放 PR，未发现重复声明或超出 cap。`
  )
} catch (error) {
  setOutput('blocked', 'true')
  summary(`## ❌ Build Control dispatch preflight：读取 GitHub 事实失败，按拦截处理\n\n${error.message}`)
  process.exit(1)
}
