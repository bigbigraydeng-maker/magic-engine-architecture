#!/usr/bin/env node
/**
 * CLI entrypoint for the Claude dispatch preflight, wired into
 * `.github/workflows/claude.yml` as a job that must succeed with
 * `blocked=false` before the `claude` job (the one that spends a model call)
 * is allowed to run.
 *
 * Fails closed: any error reading GitHub facts (auth, network, pagination)
 * exits non-zero, which the workflow treats as blocked — "we could not check"
 * must never be treated as "nothing was wrong". No model call happens on
 * either the blocked or the fail-closed path, because both stop *before* the
 * `claude` job's `if:` can turn true.
 *
 * The race this cannot fully close by itself (two dispatches for the same
 * Issue landing before either has opened a PR) is handled at the workflow
 * level by a `concurrency:` group keyed on the Issue number with
 * `cancel-in-progress: false`, so a second dispatch queues behind the first
 * rather than running concurrently — see the comment in claude.yml.
 */
import { appendFileSync } from 'node:fs'

import { createGitHubClient } from './github.mjs'
import { evaluateDispatchPreflight } from './dispatch-preflight.mjs'

function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
  console.log(text)
}

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

const token = process.env.GITHUB_TOKEN
const repository = process.env.GITHUB_REPOSITORY
const isNewImplementationDispatch = process.env.IS_NEW_IMPLEMENTATION_DISPATCH === 'true'
const issueNumberRaw = process.env.ISSUE_NUMBER

if (!token || !repository) {
  console.error('GITHUB_TOKEN and GITHUB_REPOSITORY are required')
  process.exit(1)
}

if (!isNewImplementationDispatch) {
  setOutput('blocked', 'false')
  summary('## ⏭️ Build Control dispatch preflight：不适用\n\n本次触发不是新的 Issue 派发（例如 PR 复审/整改评论），不受重复检测与 cap 约束。')
  process.exit(0)
}

const issueNumber = issueNumberRaw ? Number(issueNumberRaw) : null
const [owner, repo] = repository.split('/')

try {
  const client = createGitHubClient({ token })
  const openPullRequests = await client.listOpenPullRequests({ owner, repo })

  const result = evaluateDispatchPreflight({
    isNewImplementationDispatch,
    issueNumber,
    openPullRequests,
    // The concurrency group in claude.yml is the mechanism for the
    // same-issue race; this script has no reliable, low-privilege way to
    // enumerate "other in-flight workflow runs" without `actions: read`
    // beyond what is already granted, so it is left empty here rather than
    // faked. See file header.
    activeLaneIssueNumbers: [],
  })

  setOutput('blocked', String(result.blocked))

  if (result.blocked) {
    summary(
      [
        '## ❌ Build Control dispatch preflight：拦截',
        '',
        `Issue #${issueNumber} 的派发被拦截，Claude 不会被调用：`,
        '',
        ...result.reasons.map((r) => `- ${r}`),
      ].join('\n')
    )
  } else {
    summary(`## ✅ Build Control dispatch preflight：通过\n\nIssue #${issueNumber}，当前 ${openPullRequests.length} 个开放 PR，未发现重复声明或超出 cap。`)
  }
} catch (error) {
  setOutput('blocked', 'true')
  summary(`## ❌ Build Control dispatch preflight：读取 GitHub 事实失败，按拦截处理\n\n${error.message}`)
  process.exit(1)
}
