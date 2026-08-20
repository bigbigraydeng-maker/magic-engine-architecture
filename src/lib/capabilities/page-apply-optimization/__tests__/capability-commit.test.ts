/**
 * commit step 的两条分支：
 *   (a) commitFile 抛 + branch 上内容 = patched_content → 真幂等（重试成功过）
 *   (b) commitFile 抛 + branch 上内容 ≠ patched_content → 真 stale，fail-closed
 *
 * 魏征 Issue 1 + 狄仁杰 Attack 2 都指向老代码 `/409|422|conflict|sha/i` 会把 (b) 吞成
 * "成功"。本文件专门盯着 (b) 必须 INVALID_STATE，(a) 必须成功。
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthorizedExecutionContext } from '@/lib/kernel/types'
import { createPageApplyOptimizationCapability } from '..'

const PATCHED = '<html>PATCHED</html>'
const OLD_BASE = '<html>OLD</html>'

function ctx(): AuthorizedExecutionContext {
  return {
    decisionId: 'd', runId: 'r', clientId: 'c',
    actionKey: 'page.apply_optimization_request', actionVersion: 1,
    policyVersion: 1, costCapUsd: null, idempotencyKey: 'k', expiresAt: null,
  } as unknown as AuthorizedExecutionContext
}
function noopSb(): SupabaseClient {
  return { from: () => ({ select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) } as unknown as SupabaseClient
}

const PREP = {
  repo_owner: 'o', repo_name: 'r', default_branch: 'main',
  content_path: 'website/x.html', page_version_token: 'sha_prepare',
  branch_name: 'me/page-apply/idem',
  patched_content: PATCHED,
  diff_changes: [],
}

async function runCommit(gh: any) {
  const cap = createPageApplyOptimizationCapability(noopSb(), {
    resolveGithubConnection: async () => ({
      repoOwner: 'o', repoName: 'r', defaultBranch: 'main',
      contentPaths: ['website/x.html'], plainToken: 't',
    }),
    createGithubClient: () => gh,
  })
  return cap.steps.commit({
    ctx: ctx(), stepKey: 'commit', attempt: 1, idempotencyKey: 'x',
    // stepCommit 不用 runInput，但 CapabilityStepContext 类型层要求 —— 传空对象即可
    runInput: {},
    priorOutputs: { prepare: PREP as unknown as Record<string, unknown> },
  })
}

describe('commit step · stale-race defense', () => {
  it('(a) commitFile 抛 + branch 上是 patched_content → 幂等，commit_created:true', async () => {
    const gh = {
      async getBranchSha() { return 'base' },
      async createBranch() { /* ok */ },
      async commitFile() { throw new Error('422 sha does not match') },
      async getFileContent(_o: string, _r: string, _p: string, branch: string) {
        // 模拟前一次 commit 已经写入，branch 上现在是 patched 内容
        return { sha: 'newsha', content: '', size: 0, decodedContent: branch === 'main' ? OLD_BASE : PATCHED }
      },
    }
    const result = await runCommit(gh)
    expect(result.output.commit_created).toBe(true)
  })

  it('(b) commitFile 抛 + branch 上不是 patched_content → INVALID_STATE stale_snapshot_at_commit', async () => {
    const gh = {
      async getBranchSha() { return 'base' },
      async createBranch() { /* ok */ },
      async commitFile() { throw new Error('422 sha does not match') },
      async getFileContent() {
        // main 已经被别人移动过；branch 上的文件是 main 的新版（未 patched）
        return { sha: 'differentsha', content: '', size: 0, decodedContent: '<html>SOMETHING_ELSE</html>' }
      },
    }
    await expect(runCommit(gh)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      humanReason: expect.stringMatching(/stale_snapshot_at_commit/),
    })
  })

  it('狄仁杰 Attack 2：错误消息含 "sha" 但真实是 5xx —— 内容不匹配则 fail-closed', async () => {
    const gh = {
      async getBranchSha() { return 'base' },
      async createBranch() { /* ok */ },
      async commitFile() { throw new Error('500 internal sha computation timeout') },
      async getFileContent() {
        // commitFile 从没成功过 → branch 上还是 base 内容
        return { sha: 'basesha', content: '', size: 0, decodedContent: OLD_BASE }
      },
    }
    await expect(runCommit(gh)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      humanReason: expect.stringMatching(/stale_snapshot_at_commit/),
    })
  })

  it('commitFile 成功 → 直接 commit_created:true，不查 branch', async () => {
    let getFileCalls = 0
    const gh = {
      async getBranchSha() { return 'base' },
      async createBranch() { /* ok */ },
      async commitFile() { /* success */ },
      async getFileContent() { getFileCalls++; return { sha: 's', content: '', size: 0, decodedContent: PATCHED } },
    }
    const result = await runCommit(gh)
    expect(result.output.commit_created).toBe(true)
    expect(getFileCalls).toBe(0)
  })

  // ── Scenario 2 (same-run crash/retry) —— 422 + tip 是本 run 建的 branch ──
  it('scenario 2a · createBranch 422 + tip === baseSha (fresh branch from prior crash) → adopt + commit', async () => {
    const gh = {
      async getBranchSha(_o: string, _r: string, branch: string) {
        // main tip 与 branch tip 都是 'base'：branch 是空的 fresh createBranch
        return 'base'
      },
      async createBranch() { throw new Error('422 Reference already exists') },
      async getCommit() { throw new Error('should not be called when isFreshFromBase') },
      async commitFile() { /* success */ },
      async getFileContent() { return { sha: 's', content: '', size: 0, decodedContent: PATCHED } },
    }
    const result = await runCommit(gh)
    expect(result.output.commit_created).toBe(true)
  })

  it('scenario 2b · createBranch 422 + tip commit 带本 run marker → adopt + commit', async () => {
    let commitFileCalled = false
    const gh = {
      async getBranchSha(_o: string, _r: string, branch: string) {
        if (branch === 'main') return 'base'
        return 'newer-tip-sha' // owned branch tip !== base
      },
      async createBranch() { throw new Error('422 Reference already exists') },
      async getCommit() { return { sha: 'newer-tip-sha', message: 'chore(page): apply [kernel run r]' } },
      async commitFile() { commitFileCalled = true },
      async getFileContent() { return { sha: 's', content: '', size: 0, decodedContent: PATCHED } },
    }
    const result = await runCommit(gh)
    expect(result.output.commit_created).toBe(true)
    expect(commitFileCalled).toBe(true)
  })

  // ── Scenario 3 (foreign / squatted branch) —— fail-closed 零写入 ─────────
  it('scenario 3a · createBranch 422 + tip commit 不带本 run marker (客户手工建的) → INVALID_STATE 零写入', async () => {
    let commitFileCalled = false
    const gh = {
      async getBranchSha(_o: string, _r: string, branch: string) {
        if (branch === 'main') return 'base'
        return 'foreign-sha'
      },
      async createBranch() { throw new Error('422 Reference already exists') },
      async getCommit() { return { sha: 'foreign-sha', message: 'fix: someone else committed' } },
      async commitFile() { commitFileCalled = true },
      async getFileContent() { return { sha: 's', content: '', size: 0, decodedContent: PATCHED } },
    }
    await expect(runCommit(gh)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      humanReason: expect.stringMatching(/existing_branch_not_owned_by_run/),
    })
    expect(commitFileCalled).toBe(false)
  })

  it('scenario 3b · createBranch 422 + branch tip 回读失败 → INVALID_STATE 零写入', async () => {
    let commitFileCalled = false
    const gh = {
      async getBranchSha(_o: string, _r: string, branch: string) {
        if (branch === 'main') return 'base'
        throw new Error('branch read failed')
      },
      async createBranch() { throw new Error('422 Reference already exists') },
      async commitFile() { commitFileCalled = true },
    }
    await expect(runCommit(gh)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      humanReason: expect.stringMatching(/existing_branch_ownership_indeterminate/),
    })
    expect(commitFileCalled).toBe(false)
  })

  it('scenario 3c · createBranch 422 + getCommit 失败（保守视为未拥有）→ INVALID_STATE 零写入', async () => {
    let commitFileCalled = false
    const gh = {
      async getBranchSha(_o: string, _r: string, branch: string) {
        if (branch === 'main') return 'base'
        return 'unknown-sha'
      },
      async createBranch() { throw new Error('422 Reference already exists') },
      async getCommit() { throw new Error('cannot read commit') },
      async commitFile() { commitFileCalled = true },
    }
    await expect(runCommit(gh)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      humanReason: expect.stringMatching(/existing_branch_not_owned_by_run/),
    })
    expect(commitFileCalled).toBe(false)
  })
})
