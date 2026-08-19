/**
 * #1108 Kernel Outward Hardening 对齐 · 直接证明本 capability 三件事：
 *
 *   ① Trusted input: capability 从 `ctx.runInput` 读，不回查 `action_runs.input`；
 *      形状不对 → `INVALID_INPUT` fail-closed（本文件 + capability-prepare.test.ts
 *      共同覆盖，不重复 Gateway 层 hash-check 已经证明的行为）。
 *
 *   ② Rollback handler: provider-native GitHub 撤回，严格身份自检，
 *      拒绝 merged PR、拒绝默认分支、拒绝跨 run 分支；404 幂等；
 *      部分失败可安全重复调用（Gateway 已经在 handler 之前查 lineage，本层
 *      只测「handler 自己被真的调到时」的行为）。
 *
 *   ③ Architecture guard: 本 capability 目录里静态扫描不允许再出现
 *      `select('input')` / `from('action_runs')` 读输入的路径。
 *
 * 🔴 **不重复**测 #1108 已经证明的 Kernel 行为（例如 ROLLBACK_HANDLER_MISSING gate、
 *    lineage 二次调用挡回、hash-check TOCTOU）——那些在 kernel 层的 gateway.test.ts
 *    与 rollback.test.ts 里；这里只测 capability 侧的契约兑现。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AuthorizedExecutionContext,
  CapabilityStepContext,
  OutwardRollbackResult,
} from '@/lib/kernel/types'
import { GitHubApiError } from '@/lib/cms/github-client'
import { createPageApplyOptimizationCapability } from '..'
import { branchNameForRun, canonicalDiffHash, idempotencyKeyFromInput } from '../hash'

// ── 共用 fixtures ──────────────────────────────────────────────────────────────

const OWNER = 'client-org'
const REPO = 'client-site'
const PAGE_URL = 'https://example.com/x'
const BLOB_SHA = 'a'.repeat(40)
const APPROVED_DIFF = [
  { field: 'meta_description' as const, before: 'Old desc', after: 'New desc', changed: true },
]
const DIFF_HASH = canonicalDiffHash(APPROVED_DIFF)
const OWNED_BRANCH = branchNameForRun(idempotencyKeyFromInput(PAGE_URL, BLOB_SHA, DIFF_HASH))

const VALID_RUN_INPUT = {
  page_url: PAGE_URL,
  page_version_token: BLOB_SHA,
  validated_diff_hash: DIFF_HASH,
  intents: [{ field: 'meta_description', proposedValue: 'New desc' }],
  do_not_touch: [],
}

const PREP_OUTPUT = {
  repo_owner: OWNER, repo_name: REPO, default_branch: 'main',
  content_path: 'website/x.html',
  page_version_token: BLOB_SHA,
  branch_name: OWNED_BRANCH,
  patched_content: '<html>PATCHED</html>',
  diff_changes: APPROVED_DIFF,
}

const OPENED_OUTPUT = {
  pr_number: 42,
  pr_url: `https://github.com/${OWNER}/${REPO}/pull/42`,
}

function fakeCtx(): AuthorizedExecutionContext {
  return {
    decisionId: 'dec', runId: 'run', clientId: 'client-1',
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

interface FakeGh {
  getPullRequestState?: (o: string, r: string, n: number) => Promise<{ state: 'open' | 'closed'; merged: boolean; mergedAt: string | null }>
  closePullRequest?: (o: string, r: string, n: number) => Promise<void>
  deleteBranch?: (o: string, r: string, b: string) => Promise<void>
}

function ghFake(over: FakeGh = {}) {
  const calls = { close: [] as number[], del: [] as string[], state: [] as number[] }
  const gh = {
    async getPullRequestState(_o: string, _r: string, n: number) {
      calls.state.push(n)
      if (over.getPullRequestState) return over.getPullRequestState(_o, _r, n)
      return { state: 'open' as const, merged: false, mergedAt: null }
    },
    async closePullRequest(o: string, r: string, n: number) {
      calls.close.push(n)
      if (over.closePullRequest) return over.closePullRequest(o, r, n)
    },
    async deleteBranch(o: string, r: string, b: string) {
      calls.del.push(b)
      if (over.deleteBranch) return over.deleteBranch(o, r, b)
    },
  }
  return { gh, calls }
}

function makeCap(gh: unknown) {
  return createPageApplyOptimizationCapability(noopSb(), {
    resolveGithubConnection: async () => ({
      repoOwner: OWNER, repoName: REPO, defaultBranch: 'main',
      contentPaths: ['website/x.html'], plainToken: 't',
    }),
    createGithubClient: () => gh as never,
  })
}

function rollbackStep(runInput = VALID_RUN_INPUT): CapabilityStepContext {
  return {
    ctx: fakeCtx(), stepKey: 'rollback', attempt: 1, idempotencyKey: 'idem:rollback',
    runInput,
    priorOutputs: {
      prepare: PREP_OUTPUT as unknown as Record<string, unknown>,
      commit: { commit_created: true },
      open_pr: OPENED_OUTPUT as unknown as Record<string, unknown>,
    },
  }
}

// ── (③) Architecture guard: no action_runs.input read in this dir ────────────

describe('architecture-guard · capability 目录里不许再回读 action_runs.input', () => {
  it('本 capability 目录（含子目录）不含 select(\'input\') / from(\'action_runs\') 组合', () => {
    // 允许「概念性提到」——只禁**实际的** supabase 查询调用
    const dir = join(__dirname, '..')
    const files: string[] = []
    const walk = (p: string) => {
      for (const name of readdirSync(p)) {
        const full = join(p, name)
        const st = statSync(full)
        if (st.isDirectory()) {
          if (name === '__tests__') continue // 测试文件豁免（我们自己写 fake 用得到）
          walk(full)
        } else if (name.endsWith('.ts')) {
          files.push(full)
        }
      }
    }
    walk(dir)
    const offenders: string[] = []
    for (const f of files) {
      const text = readFileSync(f, 'utf8')
      // 匹配 .from('action_runs') 或 .from("action_runs")
      const hasFromActionRuns = /\.from\(\s*['"]action_runs['"]\s*\)/.test(text)
      const hasSelectInput = /\.select\(\s*['"]input['"]/.test(text)
      if (hasFromActionRuns && hasSelectInput) {
        offenders.push(f)
      }
    }
    expect(offenders, `capability 里发现了 action_runs.input 回读：${offenders.join(', ')}`).toEqual([])
  })
})

// ── (①) Trusted input · shape fail-closed ─────────────────────────────────────

describe('trusted runInput · shape 错必须 INVALID_INPUT fail-closed', () => {
  it('runInput 缺字段 → INVALID_INPUT，capability 零 provider 调用', async () => {
    const { gh, calls } = ghFake()
    const cap = makeCap(gh)
    let caught: any = null
    try {
      await cap.steps.prepare({
        ctx: fakeCtx(), stepKey: 'prepare', attempt: 1, idempotencyKey: 'x',
        priorOutputs: {},
        runInput: { page_url: PAGE_URL /* 缺 page_version_token 等 */ },
      })
    } catch (e) { caught = e }
    expect(caught.code).toBe('INVALID_INPUT')
    // 零 provider 调用：不能因为 shape 错就跑到 GitHub
    expect(calls.state.length + calls.close.length + calls.del.length).toBe(0)
  })

  it('runInput 类型不对 → INVALID_INPUT', async () => {
    const { gh } = ghFake()
    const cap = makeCap(gh)
    let caught: any = null
    try {
      await cap.steps.prepare({
        ctx: fakeCtx(), stepKey: 'prepare', attempt: 1, idempotencyKey: 'x',
        priorOutputs: {},
        runInput: {
          page_url: PAGE_URL,
          page_version_token: BLOB_SHA,
          validated_diff_hash: DIFF_HASH,
          intents: 'not-an-array', // ← 类型错
          do_not_touch: [],
        },
      })
    } catch (e) { caught = e }
    expect(caught.code).toBe('INVALID_INPUT')
    expect(caught.humanReason).toMatch(/ctx\.runInput/)
  })
})

// ── (②) Rollback handler · 场景矩阵 ────────────────────────────────────────────

describe('rollback handler · noop 快速路径', () => {
  it('场景 1（commit 后、open PR 前失败）：无 open_pr priorOutput → 只删分支不关 PR', async () => {
    // 语义：commit 已成，PR 未开 → 分支存在但没有 PR。rollback = delete branch only
    const { gh, calls } = ghFake()
    const cap = makeCap(gh)
    const step: CapabilityStepContext = {
      ctx: fakeCtx(), stepKey: 'rollback', attempt: 1, idempotencyKey: 'idem:rollback',
      runInput: VALID_RUN_INPUT,
      priorOutputs: {
        prepare: PREP_OUTPUT as unknown as Record<string, unknown>,
        commit: { commit_created: true },
        // 无 open_pr
      },
    }
    const result = await cap.rollback!(step, step.priorOutputs)
    expect(result.ok).toBe(true)
    expect(result.rollbackKind).toBe('provider_native')
    expect(calls.close).toEqual([]) // 未 open_pr → 不 close
    expect(calls.del).toEqual([OWNED_BRANCH])
  })

  it('prep 完成、commit 未完成 → noop（provider 零副作用）', async () => {
    const { gh, calls } = ghFake()
    const cap = makeCap(gh)
    const step: CapabilityStepContext = {
      ctx: fakeCtx(), stepKey: 'rollback', attempt: 1, idempotencyKey: 'x',
      runInput: VALID_RUN_INPUT,
      priorOutputs: { prepare: PREP_OUTPUT as unknown as Record<string, unknown> },
    }
    const result = await cap.rollback!(step, step.priorOutputs)
    expect(result.ok).toBe(true)
    expect(result.rollbackKind).toBe('noop')
    expect(calls.close.length + calls.del.length).toBe(0)
  })

  it('prep 都未完成 → noop', async () => {
    const { gh } = ghFake()
    const cap = makeCap(gh)
    const step: CapabilityStepContext = {
      ctx: fakeCtx(), stepKey: 'rollback', attempt: 1, idempotencyKey: 'x',
      runInput: VALID_RUN_INPUT,
      priorOutputs: {},
    }
    const result = await cap.rollback!(step, step.priorOutputs)
    expect(result.ok).toBe(true)
    expect(result.rollbackKind).toBe('noop')
  })
})

describe('rollback handler · happy path (场景 2 + 3)', () => {
  it('场景 2（Draft PR 已开 + record 前失败）：close PR + delete branch，都成功', async () => {
    const { gh, calls } = ghFake()
    const cap = makeCap(gh)
    const result = await cap.rollback!(rollbackStep(), rollbackStep().priorOutputs)
    expect(result.ok).toBe(true)
    expect(result.rollbackKind).toBe('provider_native')
    expect(calls.state).toEqual([42])
    expect(calls.close).toEqual([42])
    expect(calls.del).toEqual([OWNED_BRANCH])
    expect(result.detail).toMatchObject({ pr_state: 'closed_by_rollback', branch_state: 'deleted_by_rollback' })
  })

  it('场景 3（verification 失败）：同 happy path（rollback 无法区分 open_pr 之后哪里失败）', async () => {
    // 场景 3 与场景 2 在 handler 侧行为相同：都是 close + delete
    const { gh, calls } = ghFake()
    const cap = makeCap(gh)
    const result = await cap.rollback!(rollbackStep(), rollbackStep().priorOutputs)
    expect(result.ok).toBe(true)
    expect(calls.close).toEqual([42])
    expect(calls.del).toEqual([OWNED_BRANCH])
  })
})

describe('rollback handler · 幂等 (场景 4 + 5 + 6)', () => {
  it('场景 6a（PR 已 404）→ 视为已撤，继续删分支', async () => {
    const { gh, calls } = ghFake({
      getPullRequestState: async () => { throw new GitHubApiError(404, 'Not Found') },
    })
    const cap = makeCap(gh)
    const result = await cap.rollback!(rollbackStep(), rollbackStep().priorOutputs)
    expect(result.ok).toBe(true)
    expect(calls.close).toEqual([]) // PR 404 → 不需 close
    expect(calls.del).toEqual([OWNED_BRANCH])
    expect(result.detail).toMatchObject({ pr_state: '404_not_found', branch_state: 'deleted_by_rollback' })
  })

  it('场景 6b（branch 已 404）→ 视为已删，rollback ok', async () => {
    const { gh, calls } = ghFake({
      deleteBranch: async () => { throw new GitHubApiError(404, 'Not Found') },
    })
    const cap = makeCap(gh)
    const result = await cap.rollback!(rollbackStep(), rollbackStep().priorOutputs)
    expect(result.ok).toBe(true)
    expect(calls.close).toEqual([42])
    expect(result.detail).toMatchObject({ branch_state: '404_not_found' })
  })

  it('场景 6c（PR closePullRequest 404）→ 视为已关，继续删分支', async () => {
    const { gh, calls } = ghFake({
      closePullRequest: async () => { throw new GitHubApiError(404, 'Not Found') },
    })
    const cap = makeCap(gh)
    const result = await cap.rollback!(rollbackStep(), rollbackStep().priorOutputs)
    expect(result.ok).toBe(true)
    expect(result.detail).toMatchObject({ pr_state: '404_on_close', branch_state: 'deleted_by_rollback' })
    expect(calls.del).toEqual([OWNED_BRANCH])
  })

  it('PR 已 closed 且未 merge → 视为已撤，不重复 close，继续删分支', async () => {
    const { gh, calls } = ghFake({
      getPullRequestState: async () => ({ state: 'closed' as const, merged: false, mergedAt: null }),
    })
    const cap = makeCap(gh)
    const result = await cap.rollback!(rollbackStep(), rollbackStep().priorOutputs)
    expect(result.ok).toBe(true)
    expect(calls.close).toEqual([])
    expect(calls.del).toEqual([OWNED_BRANCH])
    expect(result.detail).toMatchObject({ pr_state: 'already_closed' })
  })

  it('场景 4→5（第一次 close 成功、delete branch 失败；第二次调用继续 delete）', async () => {
    // 场景 4：first call fails at deleteBranch
    let deleteFailures = 1
    const { gh: gh1, calls: calls1 } = ghFake({
      deleteBranch: async () => {
        if (deleteFailures > 0) { deleteFailures--; throw new Error('provider 500') }
      },
    })
    const cap1 = makeCap(gh1)
    const r1 = await cap1.rollback!(rollbackStep(), rollbackStep().priorOutputs)
    expect(r1.ok).toBe(false) // 场景 4：删分支失败 → fail
    expect(calls1.close).toEqual([42])

    // 场景 5：second call: PR 已 closed（第一次 close 成功了），只需继续删分支
    const { gh: gh2, calls: calls2 } = ghFake({
      getPullRequestState: async () => ({ state: 'closed' as const, merged: false, mergedAt: null }),
    })
    const cap2 = makeCap(gh2)
    const r2 = await cap2.rollback!(rollbackStep(), rollbackStep().priorOutputs)
    expect(r2.ok).toBe(true)
    expect(calls2.close).toEqual([]) // 不重复关闭（PR 已 closed）
    expect(calls2.del).toEqual([OWNED_BRANCH]) // 继续删分支
  })
})

describe('rollback handler · 安全护栏 (场景 7 + 8 merged/cross-run)', () => {
  it('场景 7（PR 已 merge）→ fail-closed，绝不 close，绝不 delete branch', async () => {
    const { gh, calls } = ghFake({
      getPullRequestState: async () => ({
        state: 'closed' as const, merged: true, mergedAt: '2026-01-01T00:00:00Z',
      }),
    })
    const cap = makeCap(gh)
    const result = await cap.rollback!(rollbackStep(), rollbackStep().priorOutputs)
    expect(result.ok).toBe(false)
    expect(result.rollbackKind).toBe('provider_native')
    expect(result.failure_reason).toMatch(/已被合并/)
    expect(calls.close).toEqual([]) // 关键：绝不 close
    expect(calls.del).toEqual([])   // 关键：绝不删分支
  })

  it('场景 8a（branch 不属于本 run，含斜杠或不合前缀）→ 拒绝', async () => {
    const { gh, calls } = ghFake()
    const cap = makeCap(gh)
    const badPrep = { ...PREP_OUTPUT, branch_name: 'main' } // ← 攻击：塞入 main 分支
    const step: CapabilityStepContext = {
      ctx: fakeCtx(), stepKey: 'rollback', attempt: 1, idempotencyKey: 'x',
      runInput: VALID_RUN_INPUT,
      priorOutputs: {
        prepare: badPrep as unknown as Record<string, unknown>,
        commit: { commit_created: true },
        open_pr: OPENED_OUTPUT as unknown as Record<string, unknown>,
      },
    }
    const result = await cap.rollback!(step, step.priorOutputs)
    expect(result.ok).toBe(false)
    expect(result.failure_reason).toMatch(/me\/page-apply/)
    expect(calls.close.length + calls.del.length).toBe(0)
  })

  it('场景 8b（branch prefix 对但派生跟 runInput 重算不一致）→ 拒绝跨 run', async () => {
    const { gh, calls } = ghFake()
    const cap = makeCap(gh)
    // branch 名合法（`me/page-apply/<24hex>`）但派生自不同 runInput（idempotency-key 不匹配）
    const foreignBranch = 'me/page-apply/' + 'b'.repeat(24)
    const badPrep = { ...PREP_OUTPUT, branch_name: foreignBranch }
    const step: CapabilityStepContext = {
      ctx: fakeCtx(), stepKey: 'rollback', attempt: 1, idempotencyKey: 'x',
      runInput: VALID_RUN_INPUT,
      priorOutputs: {
        prepare: badPrep as unknown as Record<string, unknown>,
        commit: { commit_created: true },
        open_pr: OPENED_OUTPUT as unknown as Record<string, unknown>,
      },
    }
    const result = await cap.rollback!(step, step.priorOutputs)
    expect(result.ok).toBe(false)
    expect(result.failure_reason).toMatch(/跟 ctx\.runInput 重算不一致|不属于本 run/)
    expect(calls.close.length + calls.del.length).toBe(0)
  })

  it('场景 8c（branch === default_branch）→ 硬性拒绝', async () => {
    const { gh, calls } = ghFake()
    const cap = makeCap(gh)
    // 构造：branch_name 与 default_branch 都设成同一个合法前缀值
    const badBranch = 'me/page-apply/' + 'c'.repeat(24)
    const badPrep = {
      ...PREP_OUTPUT,
      branch_name: badBranch,
      default_branch: badBranch, // ← 攻击：把 default_branch 也塞成一样的
    }
    const step: CapabilityStepContext = {
      ctx: fakeCtx(), stepKey: 'rollback', attempt: 1, idempotencyKey: 'x',
      runInput: VALID_RUN_INPUT,
      priorOutputs: {
        prepare: badPrep as unknown as Record<string, unknown>,
        commit: { commit_created: true },
        open_pr: OPENED_OUTPUT as unknown as Record<string, unknown>,
      },
    }
    const result = await cap.rollback!(step, step.priorOutputs)
    expect(result.ok).toBe(false)
    // 先命中 branch 派生不一致（因为 runInput 派生出的 OWNED_BRANCH 不是 badBranch），
    // 或者命中 default_branch 相等；两者任一都必须挡回。
    expect(calls.close.length + calls.del.length).toBe(0)
  })
})

describe('rollback handler · 非 404 provider 错误 fail-not-swallow', () => {
  it('closePullRequest 500 → ok:false, failure_reason 带 msg（不吞成 ok:true）', async () => {
    const { gh, calls } = ghFake({
      closePullRequest: async () => { throw new Error('provider 500') },
    })
    const cap = makeCap(gh)
    const result = await cap.rollback!(rollbackStep(), rollbackStep().priorOutputs)
    expect(result.ok).toBe(false)
    expect(result.failure_reason).toMatch(/closePullRequest 失败/)
    expect(calls.del).toEqual([]) // 关键：close 失败不进入 delete，避免把 branch 删掉但 PR 挂着
  })

  it('resolveGithubConnection 返 null → ok:false, 不做任何 provider 调用', async () => {
    const cap = createPageApplyOptimizationCapability(noopSb(), {
      resolveGithubConnection: async () => null,
      createGithubClient: () => ({}) as never,
    })
    const result = await cap.rollback!(rollbackStep(), rollbackStep().priorOutputs)
    expect(result.ok).toBe(false)
    expect(result.failure_reason).toMatch(/客户 GitHub 连接消失/)
  })
})

// ── 结构性证据：rollback 字段真的被 factory 挂上（防「declared but not wired」） ──

describe('rollback wiring · factory 真挂上 rollback', () => {
  it('createPageApplyOptimizationCapability().rollback 是 function', () => {
    const cap = createPageApplyOptimizationCapability(noopSb())
    expect(typeof cap.rollback).toBe('function')
  })
})
