#!/usr/bin/env node
/**
 * CLI entrypoint for `.github/workflows/build-control-merge-auth.yml`.
 *
 * Passes only when the PR's current, full head SHA has a trusted
 * `ME_MERGE_AUTH_V1` comment naming that exact SHA, authored by an
 * allow-listed login whose name the payload itself declares. A push
 * automatically invalidates any older authorisation because the marker names
 * the SHA it was written for.
 *
 * The verdict is always written as an explicit check run against the head SHA
 * fetched from the API — not from the event payload, which carries no head SHA
 * at all on `issue_comment` and points at the base under
 * `pull_request_target`.
 */
import { createGitHubClient } from './github.mjs'
import { isMergeAuthorized, selectTrustedMergeAuthRecords } from './merge-auth.mjs'
import { requireAllowlist, requireEnv, splitRepository, summary } from './cli-runtime.mjs'
import { MERGE_AUTH_CHECK_NAME as CHECK_NAME } from './check-names.mjs'

const env = requireEnv(['GITHUB_TOKEN', 'GITHUB_REPOSITORY', 'PR_NUMBER'])
const allowlist = requireAllowlist('MERGE_AUTH_ALLOWLIST')
const { owner, repo } = splitRepository(env.GITHUB_REPOSITORY)
const prNumber = Number(env.PR_NUMBER)

const client = createGitHubClient({ token: env.GITHUB_TOKEN })

try {
  const [pr, comments] = await Promise.all([
    client.getPullRequest({ owner, repo, prNumber }),
    client.listIssueComments({ owner, repo, issueNumber: prNumber }),
  ])

  const records = selectTrustedMergeAuthRecords({ comments, allowlist })
  const decision = isMergeAuthorized({ records, prNumber, currentHeadSha: pr.headSha })

  const text = decision.authorized
    ? `PR #${prNumber} head \`${pr.headSha}\` 由 ${decision.record.authorized_by} 于 ${decision.record.authorized_at} 授权。`
    : `${decision.reason}\n\n当前 head：\`${pr.headSha}\`。授权按 exact SHA 绑定，推送会自动使旧授权失效，需要针对新 SHA 重新授权。`

  await client.createCheckRun({
    owner,
    repo,
    headSha: pr.headSha,
    name: CHECK_NAME,
    conclusion: decision.authorized ? 'success' : 'failure',
    title: CHECK_NAME,
    summary: text,
  })
  summary(`## ${decision.authorized ? '✅' : '❌'} ${CHECK_NAME}\n\n${text}`)
  process.exit(decision.authorized ? 0 : 1)
} catch (error) {
  summary(`## ❌ ${CHECK_NAME}：读取 GitHub 事实失败，按失败处理\n\n${error.message}`)
  process.exit(1)
}
