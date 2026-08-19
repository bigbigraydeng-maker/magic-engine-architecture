/**
 * 复审 2026-08-19 修正（两位 reviewer 一致 P0：rollback 链路缺失）：
 * v1 不带自动 rollback dispatch —— capability 必须在任何**branch/PR 已经创建之后**
 * 发生的失败路径里，把孤儿 artefact 的直达链接塞进 `humanReason` /
 * `RetryableCapabilityError.message` / `verification.failure_reason`，让
 * `failRun → run.last_error → handoff.ts → 今日待办的 what 字段` 能被 PM 一眼看见。
 *
 * 本文件是**行为验证**，不是「存在验证」：只断言"错误消息里能找到 branch/PR 直达
 * 链接"是行为证据，`grep 存在` 不算数（memory: [[feedback-declared-but-not-wired]]）。
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthorizedExecutionContext } from '@/lib/kernel/types'
import { canonicalDiffHash } from '../hash'
import { createPageApplyOptimizationCapability } from '..'

// ── 共用 fixtures ──────────────────────────────────────────────────────────────

const BRANCH = 'me/page-apply/idem'
const OWNER = 'client-org'
const REPO = 'client-site'
const EXPECTED_BRANCH_URL =
  `https://github.com/${OWNER}/${REPO}/tree/${BRANCH}`

function ctx(): AuthorizedExecutionContext {
  return {
    decisionId: 'dec1', runId: 'run1', clientId: 'c',
    actionKey: 'page.apply_optimization_request', actionVersion: 1,
    policyVersion: 1, costCapUsd: null, idempotencyKey: 'idem', expiresAt: null,
  } as unknown as AuthorizedExecutionContext
}

function noopSb(): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }),
  } as unknown as SupabaseClient
}

const PREP = {
  repo_owner: OWNER, repo_name: REPO, default_branch: 'main',
  content_path: 'website/x.html',
  page_version_token: 'sha_prepare',
  branch_name: BRANCH,
  patched_content: '<html>PATCHED</html>',
  diff_changes: [{ field: 'meta_description', before: 'a', after: 'b', changed: true }],
}

function connDeps() {
  return {
    resolveGithubConnection: async () => ({
      repoOwner: OWNER, repoName: REPO, defaultBranch: 'main',
      contentPaths: ['website/x.html'], plainToken: 't',
    }),
  }
}

// ── stepCommit ────────────────────────────────────────────────────────────────

describe('orphan-hint · stepCommit stale', () => {
  it('真 stale (branch content != patched) → humanReason 带 branch tree URL + detail.orphanBranch*', async () => {
    const gh = {
      async getBranchSha() { return 'basesha' },
      async createBranch() { /* ok, branch now exists */ },
      async commitFile() { throw new Error('422 sha does not match') },
      async getFileContent() {
        return { sha: 'differentsha', content: '', size: 0, decodedContent: '<html>OTHER</html>' }
      },
    }
    const cap = createPageApplyOptimizationCapability(noopSb(), { ...connDeps(), createGithubClient: () => gh })
    let caught: any = null
    try {
      await cap.steps.commit({
        ctx: ctx(), stepKey: 'commit', attempt: 1, idempotencyKey: 'x',
        priorOutputs: { prepare: PREP as unknown as Record<string, unknown> },
      })
    } catch (e) { caught = e }
    expect(caught).toBeTruthy()
    expect(caught.code).toBe('INVALID_STATE')
    expect(caught.humanReason).toMatch(/stale_snapshot_at_commit/)
    // 直达链接必须出现在 humanReason 里（handoff.ts 只读 last_error string）
    expect(caught.humanReason).toContain(EXPECTED_BRANCH_URL)
    expect(caught.humanReason).toContain('客户 GitHub 仓库残留孤儿 artefact')
    // detail 里必须结构化带出 orphan 信息（未来 handoff v2 能解析）
    expect(caught.detail.orphanBranch).toBe(BRANCH)
    expect(caught.detail.orphanBranchUrl).toBe(EXPECTED_BRANCH_URL)
  })
})

// ── stepOpenPr ────────────────────────────────────────────────────────────────

describe('orphan-hint · stepOpenPr 状态不自洽路径', () => {
  it('422 + listPullRequestsByHead 抛错 → INVALID_STATE + 直达链接', async () => {
    const gh = {
      async createPullRequest() { throw new Error('422 already exists') },
      async listPullRequestsByHead() { throw new Error('provider 500') },
    }
    const cap = createPageApplyOptimizationCapability(noopSb(), { ...connDeps(), createGithubClient: () => gh })
    let caught: any = null
    try {
      await cap.steps.open_pr({
        ctx: ctx(), stepKey: 'open_pr', attempt: 1, idempotencyKey: 'x',
        priorOutputs: { prepare: PREP as unknown as Record<string, unknown> },
      })
    } catch (e) { caught = e }
    expect(caught.code).toBe('INVALID_STATE')
    expect(caught.humanReason).toMatch(/查询也失败/)
    expect(caught.humanReason).toContain(EXPECTED_BRANCH_URL)
    expect(caught.detail.orphanBranch).toBe(BRANCH)
  })

  it('422 + listPullRequestsByHead 返回 [] → INVALID_STATE + 直达链接', async () => {
    const gh = {
      async createPullRequest() { throw new Error('422 already exists') },
      async listPullRequestsByHead() { return [] },
    }
    const cap = createPageApplyOptimizationCapability(noopSb(), { ...connDeps(), createGithubClient: () => gh })
    let caught: any = null
    try {
      await cap.steps.open_pr({
        ctx: ctx(), stepKey: 'open_pr', attempt: 1, idempotencyKey: 'x',
        priorOutputs: { prepare: PREP as unknown as Record<string, unknown> },
      })
    } catch (e) { caught = e }
    expect(caught.code).toBe('INVALID_STATE')
    expect(caught.humanReason).toMatch(/找不到/)
    expect(caught.humanReason).toContain(EXPECTED_BRANCH_URL)
    expect(caught.detail.orphanBranch).toBe(BRANCH)
  })
})

describe('orphan-hint · stepOpenPr retryable', () => {
  it('其它 500 → RetryableCapabilityError.message 带 branch tree URL', async () => {
    const gh = {
      async createPullRequest() { throw new Error('500 internal server error') },
    }
    const cap = createPageApplyOptimizationCapability(noopSb(), { ...connDeps(), createGithubClient: () => gh })
    let caught: any = null
    try {
      await cap.steps.open_pr({
        ctx: ctx(), stepKey: 'open_pr', attempt: 1, idempotencyKey: 'x',
        priorOutputs: { prepare: PREP as unknown as Record<string, unknown> },
      })
    } catch (e) { caught = e }
    // gateway.ts:1016 用 humanReasonOf(err) → 对 RetryableCapabilityError 返回 err.message，
    // 所以 message 里带 branch URL，重试用尽后 PM 能在今日待办看到孤儿分支。
    expect(caught.constructor.name).toBe('RetryableCapabilityError')
    expect(String(caught.message)).toMatch(/pr_open_failed/)
    expect(String(caught.message)).toContain(EXPECTED_BRANCH_URL)
  })
})

// ── stepRecord verification failure ───────────────────────────────────────────

const BLOB_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const HTML_BASE = `<!doctype html>
<html><head>
<title>Old T</title>
<meta name="description" content="Old desc">
</head><body></body></html>`
const HTML_HEAD_HAPPY = `<!doctype html>
<html><head>
<title>Old T</title>
<meta name="description" content="New desc">
</head><body></body></html>`

const APPROVED_DIFF = [
  { field: 'meta_description' as const, before: 'Old desc', after: 'New desc', changed: true },
]

const PREP_RECORD = {
  repo_owner: OWNER, repo_name: REPO, default_branch: 'main',
  content_path: 'website/x.html',
  page_version_token: BLOB_SHA,
  branch_name: BRANCH,
  patched_content: HTML_HEAD_HAPPY,
  diff_changes: APPROVED_DIFF,
}

const RUN_INPUT = {
  page_url: 'https://example.com/x',
  page_version_token: BLOB_SHA,
  validated_diff_hash: canonicalDiffHash(APPROVED_DIFF),
  intents: [{ field: 'meta_description', proposedValue: 'New desc' }],
  do_not_touch: [],
}

function sbForRecord(): SupabaseClient {
  return {
    from(table: string) {
      return {
        select() { return this },
        eq() { return this },
        limit() {
          if (table === 'action_runs') return Promise.resolve({ data: [{ input: RUN_INPUT }], error: null })
          if (table === 'authorization_decisions') return Promise.resolve({ data: [{ id: 'dec1' }], error: null })
          return Promise.resolve({ data: [], error: null })
        },
      }
    },
  } as unknown as SupabaseClient
}

describe('orphan-hint · stepRecord verification failure', () => {
  it('base blob 已移动（②断言 fail）→ failure_reason 带 PR URL + branch URL', async () => {
    const PR_NUMBER = 42
    const PR_URL = `https://github.com/${OWNER}/${REPO}/pull/${PR_NUMBER}`
    const gh = {
      async getPullRequestState() {
        return { state: 'open' as const, merged: false, mergedAt: null }
      },
      async getFileContent(_o: string, _r: string, _p: string, branch: string) {
        if (branch === 'main') {
          // 断言②故意 fail：main blob 已经不是 page_version_token
          return { sha: 'differentSHA', content: '', size: 0, decodedContent: HTML_BASE }
        }
        return { sha: 'headsha', content: '', size: 0, decodedContent: HTML_HEAD_HAPPY }
      },
    }
    const cap = createPageApplyOptimizationCapability(sbForRecord(), { ...connDeps(), createGithubClient: () => gh })
    const result = await cap.steps.record({
      ctx: ctx(), stepKey: 'record', attempt: 1, idempotencyKey: 'x',
      priorOutputs: {
        prepare: PREP_RECORD as unknown as Record<string, unknown>,
        open_pr: { pr_number: PR_NUMBER, pr_url: PR_URL },
      },
    })
    expect(result.verification?.passed).toBe(false)
    const reason = result.verification?.failure_reason ?? ''
    expect(reason).toMatch(/PR 基于 approved 版本/)
    // 关键断言：failure_reason 里必须带 PR URL 和 branch URL 两个直达链接
    expect(reason).toContain(PR_URL)
    expect(reason).toContain(EXPECTED_BRANCH_URL)
    expect(reason).toContain(`Close 掉 Draft PR #${PR_NUMBER}`)
    expect(reason).toContain('客户 GitHub 仓库残留孤儿 artefact')
  })
})
