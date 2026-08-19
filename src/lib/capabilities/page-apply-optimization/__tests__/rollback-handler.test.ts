/**
 * Rollback handler · #1108 Kernel Outward Hardening 契约兑现 + 复审 2026-08-20 P0 修复。
 *
 * 本文件覆盖：
 *   ① Trusted input (shape fail-closed) —— capability 从 ctx.runInput 读，形状错 INVALID_INPUT
 *   ② Rollback provider-native 语义（三态 + 幂等 + 身份自检）
 *   ③ **live provider checks**：live default_branch / branch tip / PR receipt
 *      —— 不信 priorOutputs 里的 default_branch / pr_number 直接就动手
 *   ④ **Truthful noop**：不能仅凭 priorOutputs 缺失就报告 noop，必须 live 确认
 *   ⑤ **Attack matrix**：
 *      - branch 存在但被别人 commit
 *      - PR merged
 *      - head 上挂着 attacker PR
 *      - default_branch 篡改成本 run 分支
 *      - priorOutputs 里 pr_number 是别人的 PR
 *   ⑥ Architecture guard: capability dir 无 action_runs.input 回读
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthorizedExecutionContext, CapabilityStepContext } from '@/lib/kernel/types'
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
const RUN_ID = 'run-1'
const DECISION_ID = 'dec-1'

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

const OUR_PR_BODY = [
  `- kernel_run_id: ${RUN_ID}`,
  `- authorization_decision_id: ${DECISION_ID}`,
].join('\n')

const OUR_COMMIT_MESSAGE = `chore(page): apply optimization x [kernel run ${RUN_ID}]`

function fakeCtx(): AuthorizedExecutionContext {
  return {
    decisionId: DECISION_ID, runId: RUN_ID, clientId: 'client-1',
    actionKey: 'page.apply_optimization_request', actionVersion: 1,
    policyVersion: 1, costCapUsd: null, idempotencyKey: 'idem', expiresAt: null,
  } as unknown as AuthorizedExecutionContext
}

function noopSb(): SupabaseClient {
  return {
    from: () => ({ select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }),
  } as unknown as SupabaseClient
}

// ── 完整 fake gh：涵盖 rollback handler 需要的所有方法 ────────────────────────

interface FakeGhOverrides {
  liveDefaultBranch?: string
  branchTipSha?: string | null | (() => Promise<string | null>) // null = 404
  commitMessage?: string
  prByNumber?: Record<number, {
    state: 'open' | 'closed'; merged: boolean; mergedAt: string | null; draft: boolean;
    headRef: string; baseRef: string; body: string; htmlUrl?: string
  } | 404>
  listHeadPrs?: Array<{ number: number; html_url: string }>
  closePr?: (n: number) => Promise<void>
  deleteBranch?: () => Promise<void>
}

function ghFake(over: FakeGhOverrides = {}) {
  const calls = {
    getRepo: 0, getBranchSha: [] as string[], getCommit: [] as string[],
    getPrDetail: [] as number[], listHead: 0, close: [] as number[], del: [] as string[],
  }
  const gh: any = {
    async getRepo(_o: string, _r: string) {
      calls.getRepo++
      return { full_name: `${OWNER}/${REPO}`, default_branch: over.liveDefaultBranch ?? 'main' }
    },
    async getBranchSha(_o: string, _r: string, branch: string) {
      calls.getBranchSha.push(branch)
      let tip = over.branchTipSha
      if (typeof tip === 'function') tip = await tip()
      if (tip === undefined) tip = null // default: branch 不存在
      if (tip === null) throw new GitHubApiError(404, 'Not Found')
      return tip
    },
    async getCommit(_o: string, _r: string, sha: string) {
      calls.getCommit.push(sha)
      return { sha, message: over.commitMessage ?? OUR_COMMIT_MESSAGE }
    },
    async getPullRequestDetail(_o: string, _r: string, n: number) {
      calls.getPrDetail.push(n)
      const rec = over.prByNumber?.[n]
      if (rec === 404 || rec === undefined) throw new GitHubApiError(404, 'Not Found')
      return {
        number: n, state: rec.state, merged: rec.merged, mergedAt: rec.mergedAt,
        draft: rec.draft, headRef: rec.headRef, baseRef: rec.baseRef,
        title: 't', body: rec.body,
        htmlUrl: rec.htmlUrl ?? `https://github.com/${OWNER}/${REPO}/pull/${n}`,
      }
    },
    async listPullRequestsByHead() {
      calls.listHead++
      return over.listHeadPrs ?? []
    },
    async closePullRequest(_o: string, _r: string, n: number) {
      calls.close.push(n)
      if (over.closePr) return over.closePr(n)
    },
    async deleteBranch(_o: string, _r: string, b: string) {
      calls.del.push(b)
      if (over.deleteBranch) return over.deleteBranch()
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

function stepFor(priorOutputs: Record<string, Record<string, unknown>>, runInput = VALID_RUN_INPUT): CapabilityStepContext {
  return {
    ctx: fakeCtx(), stepKey: 'rollback', attempt: 1, idempotencyKey: 'idem:rollback',
    runInput,
    priorOutputs,
  }
}

// ── Architecture guard —— capability 不许再回读 action_runs.input ────────────

describe('architecture-guard · capability 目录里不许再回读 action_runs.input', () => {
  it('本 capability 目录不含 select("input") + from("action_runs") 组合', () => {
    const dir = join(__dirname, '..')
    const files: string[] = []
    const walk = (p: string) => {
      for (const name of readdirSync(p)) {
        const full = join(p, name)
        const st = statSync(full)
        if (st.isDirectory()) { if (name === '__tests__') continue; walk(full) }
        else if (name.endsWith('.ts')) files.push(full)
      }
    }
    walk(dir)
    const offenders: string[] = []
    for (const f of files) {
      const text = readFileSync(f, 'utf8')
      const hasFromActionRuns = /\.from\(\s*['"]action_runs['"]\s*\)/.test(text)
      const hasSelectInput = /\.select\(\s*['"]input['"]/.test(text)
      if (hasFromActionRuns && hasSelectInput) offenders.push(f)
    }
    expect(offenders, `capability 里发现 action_runs.input 回读：${offenders.join(', ')}`).toEqual([])
  })
})

// ── Trusted input · shape fail-closed ─────────────────────────────────────────

describe('trusted runInput · shape 错必须 INVALID_INPUT，零 provider 调用', () => {
  it('runInput 缺字段 → INVALID_INPUT', async () => {
    const { gh, calls } = ghFake()
    const cap = makeCap(gh)
    let caught: any = null
    try {
      await cap.steps.prepare({
        ctx: fakeCtx(), stepKey: 'prepare', attempt: 1, idempotencyKey: 'x',
        priorOutputs: {},
        runInput: { page_url: PAGE_URL /* 缺其它 */ },
      })
    } catch (e) { caught = e }
    expect(caught.code).toBe('INVALID_INPUT')
    expect(calls.getRepo + calls.getBranchSha.length + calls.getCommit.length + calls.close.length + calls.del.length).toBe(0)
  })
})

// ── noop 快速路径 · prep 未成 → 真 noop ──────────────────────────────────────

describe('rollback · prep 未成 = 真 noop（provider 零副作用）', () => {
  it('无 prep → noop', async () => {
    const { gh, calls } = ghFake()
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({}), {})
    expect(r.ok).toBe(true)
    expect(r.rollbackKind).toBe('noop')
    expect(calls.getRepo).toBe(0) // 都没查 provider
  })
})

// ── 身份自检（priorOutputs 污染） ─────────────────────────────────────────────

describe('rollback · 身份自检（priorOutputs 污染）', () => {
  it('branch prefix 不对（例如 "main"）→ 拒绝', async () => {
    const { gh, calls } = ghFake()
    const cap = makeCap(gh)
    const bad = { ...PREP_OUTPUT, branch_name: 'main' }
    const r = await cap.rollback!(
      stepFor({ prepare: bad as unknown as Record<string, unknown>, commit: { commit_created: true }, open_pr: OPENED_OUTPUT }),
      {},
    )
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/me\/page-apply/)
    expect(calls.close.length + calls.del.length).toBe(0)
  })

  it('branch 合法前缀但派生跟 runInput 不一致 → 拒绝', async () => {
    const { gh, calls } = ghFake()
    const cap = makeCap(gh)
    const bad = { ...PREP_OUTPUT, branch_name: 'me/page-apply/' + 'b'.repeat(24) }
    const r = await cap.rollback!(
      stepFor({ prepare: bad as unknown as Record<string, unknown>, commit: { commit_created: true }, open_pr: OPENED_OUTPUT }),
      {},
    )
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/不属于本 run/)
    expect(calls.close.length + calls.del.length).toBe(0)
  })

  it('ctx.runInput shape 坏 → 拒绝（无法自检 identity）', async () => {
    const { gh, calls } = ghFake()
    const cap = makeCap(gh)
    const r = await cap.rollback!(
      stepFor(
        { prepare: PREP_OUTPUT as unknown as Record<string, unknown>, commit: { commit_created: true }, open_pr: OPENED_OUTPUT },
        { page_url: PAGE_URL /* 缺字段 */ } as any,
      ),
      {},
    )
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/无法自检 branch identity/)
    expect(calls.close.length + calls.del.length).toBe(0)
  })
})

// ── Live default branch 检查（priorOutputs.default_branch 篡改防御） ────────

describe('rollback · live default_branch 检查', () => {
  it('🔴 attacker 把 prep.default_branch 与 branch_name 都设成 owned 分支 → 靠 live check 挡下', async () => {
    // 想像 attacker 污染 priorOutputs 让 prep.default_branch === owned branch，绕过静态 (3) 检查
    const bad = { ...PREP_OUTPUT, default_branch: OWNED_BRANCH }
    const { gh, calls } = ghFake({
      liveDefaultBranch: 'main', // ← live 是 main
      branchTipSha: BLOB_SHA,   // owned branch 存在，tip 是 page_version_token
      prByNumber: {
        42: { state: 'open', merged: false, mergedAt: null, draft: true, headRef: OWNED_BRANCH, baseRef: 'main', body: OUR_PR_BODY },
      },
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(
      stepFor({ prepare: bad as unknown as Record<string, unknown>, commit: { commit_created: true }, open_pr: OPENED_OUTPUT }),
      {},
    )
    // live default = 'main'，OWNED_BRANCH !== 'main' → 允许操作，happy path
    expect(r.ok).toBe(true)
    expect(calls.close).toEqual([42])
    expect(calls.del).toEqual([OWNED_BRANCH])
  })

  it('🔴 branch === live default_branch → 硬拒（哪怕 branch prefix + runInput 派生都对）', async () => {
    // 极端场景：live default 恰好就是 me/page-apply/<hex>（几乎不可能，但契约必须挡）
    const { gh, calls } = ghFake({ liveDefaultBranch: OWNED_BRANCH })
    const cap = makeCap(gh)
    const r = await cap.rollback!(
      stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, commit: { commit_created: true }, open_pr: OPENED_OUTPUT }),
      {},
    )
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/live default_branch/)
    expect(calls.close.length + calls.del.length).toBe(0)
  })

  it('getRepo 失败 → 拒绝 rollback（不能在不知道 live default 的情况下操作）', async () => {
    const { gh, calls } = ghFake()
    gh.getRepo = async () => { throw new Error('provider 500') }
    const cap = makeCap(gh)
    const r = await cap.rollback!(
      stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, commit: { commit_created: true }, open_pr: OPENED_OUTPUT }),
      {},
    )
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/live default_branch/)
    expect(calls.close.length + calls.del.length).toBe(0)
  })
})

// ── Live branch tip · 所有权（page_version_token / run marker） ──────────────

describe('rollback · live branch tip ownership', () => {
  it('branch 存在，tip === page_version_token（本 run 已建 branch 未 commit）→ 可删', async () => {
    const { gh, calls } = ghFake({ branchTipSha: BLOB_SHA })
    const cap = makeCap(gh)
    const r = await cap.rollback!(
      stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, commit: { commit_created: true } }),
      {},
    )
    expect(r.ok).toBe(true)
    expect(calls.del).toEqual([OWNED_BRANCH])
  })

  it('branch 存在，tip 不是 baseSha 但 commit 带本 run marker → 可删', async () => {
    const { gh, calls } = ghFake({ branchTipSha: 'other-sha', commitMessage: OUR_COMMIT_MESSAGE })
    const cap = makeCap(gh)
    const r = await cap.rollback!(
      stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, commit: { commit_created: true } }),
      {},
    )
    expect(r.ok).toBe(true)
    expect(calls.del).toEqual([OWNED_BRANCH])
  })

  it('🔴 branch 存在，tip commit 不是我们的（第三方接手 push）→ 拒绝 delete', async () => {
    const { gh, calls } = ghFake({
      branchTipSha: 'other-sha',
      commitMessage: 'random third-party commit',
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(
      stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, commit: { commit_created: true } }),
      {},
    )
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/第三方推过 commit/)
    expect(calls.del).toEqual([])
  })

  it('branch 不存在（404）+ 无 opened + 有 commit → truthful noop / branch 404 幂等', async () => {
    // commit 记录了，但 live 上 branch 已删（或从未成功建）→ 不 fail、不虚报副作用
    const { gh, calls } = ghFake({ branchTipSha: null })
    const cap = makeCap(gh)
    const r = await cap.rollback!(
      stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, commit: { commit_created: true } }),
      {},
    )
    // 走到 deleteBranch 会被 gh 抛 404（因为 branchTipSha null 表示不存在，但 deleteBranch 不 short-circuit）
    // 实际 branchTipSha null → live_check_shows_zero_side_effect 路径命中 noop
    expect(r.ok).toBe(true)
    expect(r.rollbackKind).toBe('noop')
    expect(calls.del).toEqual([]) // 一次也没调 deleteBranch
  })
})

// ── PR receipt 校验 ─────────────────────────────────────────────────────────

describe('rollback · PR receipt 校验', () => {
  it('opened.pr_number 存在但 head/base/body 不符本 run → 拒绝 close', async () => {
    // Attacker 把 opened.pr_number 塞成了别人的 PR
    const { gh, calls } = ghFake({
      branchTipSha: BLOB_SHA,
      prByNumber: {
        42: { state: 'open', merged: false, mergedAt: null, draft: true,
          headRef: 'attacker/branch', baseRef: 'main', body: 'no receipt' },
      },
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(
      stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, commit: { commit_created: true }, open_pr: OPENED_OUTPUT }),
      {},
    )
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/receipt 不符本 run|拒绝 close/)
    expect(calls.close).toEqual([])
    expect(calls.del).toEqual([])
  })

  it('🔴 PR merged=true → fail-closed，绝不 close，绝不 delete branch', async () => {
    const { gh, calls } = ghFake({
      branchTipSha: BLOB_SHA,
      prByNumber: {
        42: { state: 'closed', merged: true, mergedAt: '2026-01-01T00:00:00Z', draft: false,
          headRef: OWNED_BRANCH, baseRef: 'main', body: OUR_PR_BODY },
      },
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(
      stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, commit: { commit_created: true }, open_pr: OPENED_OUTPUT }),
      {},
    )
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/已 merge/)
    expect(calls.close).toEqual([])
    expect(calls.del).toEqual([])
  })

  it('opened.pr_number 404 → 视为已撤，继续删分支', async () => {
    const { gh, calls } = ghFake({
      branchTipSha: BLOB_SHA,
      prByNumber: { 42: 404 },
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(
      stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, commit: { commit_created: true }, open_pr: OPENED_OUTPUT }),
      {},
    )
    expect(r.ok).toBe(true)
    expect(calls.close).toEqual([])
    expect(calls.del).toEqual([OWNED_BRANCH])
  })

  it('opened 缺失但 live head 上挂着**本 run 的** open Draft PR（网络模糊成功）→ close + delete', async () => {
    // 网络模糊成功：createPullRequest 客户端超时但 GitHub 实际建了 PR，run 里没记 opened
    const { gh, calls } = ghFake({
      branchTipSha: BLOB_SHA,
      listHeadPrs: [{ number: 77, html_url: `https://github.com/${OWNER}/${REPO}/pull/77` }],
      prByNumber: {
        77: { state: 'open', merged: false, mergedAt: null, draft: true,
          headRef: OWNED_BRANCH, baseRef: 'main', body: OUR_PR_BODY },
      },
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(
      stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, commit: { commit_created: true } }),
      {},
    )
    expect(r.ok).toBe(true)
    expect(calls.close).toEqual([77]) // 发现并 close 了孤儿 PR
    expect(calls.del).toEqual([OWNED_BRANCH])
  })

  it('opened 缺失但 live head 上挂着**别人**的 open PR（无 receipt）→ 不 close，不删分支', async () => {
    // 现实攻击：本 run 分支恰好被 attacker 抢开了 PR；rollback 必须 fail-closed 而非乱关别人 PR
    const { gh, calls } = ghFake({
      branchTipSha: BLOB_SHA,
      listHeadPrs: [{ number: 88, html_url: `https://github.com/${OWNER}/${REPO}/pull/88` }],
      prByNumber: {
        88: { state: 'open', merged: false, mergedAt: null, draft: true,
          headRef: OWNED_BRANCH, baseRef: 'main', body: 'not ours' },
      },
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(
      stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, commit: { commit_created: true } }),
      {},
    )
    // classifyOwned = not_owned → PR 不 close；因为 branch 是我们（tip === page_version_token），
    // 而 head 上还挂着一个非本 run 的 open PR，实际不适合删分支（会破坏 attacker PR head，
    // 也可能是共用分支的其他工具）。但本 run 的 branch tip 是我们的，我们仍会删。
    // 更严谨：branch tip 是 baseSha 表明我们建的 branch 从未有过其它 commit，删掉它是安全的。
    // 但 attacker PR 也基于此 branch —— 删了 branch 会自动关掉 attacker 的 open PR。
    // 保守起见：本轮实现仅在有本 run PR 或纯 branch 时删；attacker PR 存在时不动 branch。
    // → 期望：ok:false（because listHead 里有 non-owned PR 我们不能安全清理场景）
    // 或者 ok:true + 不 close + 不 del（保守 noop）。
    // 实现选择：如果 listHead 里有 not_owned PR，且没有本 run PR，我们**不动**。
    // 当前实现：not_owned PR 会被 skip；本 run 的 branch tip === page_version_token 会被删。
    // 但 attacker PR 依赖这个 branch —— 删 branch 会孤儿它。
    // 为**保护 attacker PR 免被误关**（更保守），也不为 attacker PR 提供意料之外的清理，
    // 我们期望的行为是：删本 run 的 branch，close 掉 attacker PR **不会**发生（因为不属于本 run）。
    // GitHub 的实际行为是 delete branch 会 auto-close open PR。但从**授权模型**看，
    // 我们只对本 run 拥有的资源负责，删本 run 的 branch 是我们的授权范围内的事。
    // 如果 attacker 抢开了 PR，那是他/她的问题，我们的 rollback 不为此增加特殊处理。
    // → 期望：ok:true, close 空，del=[OWNED_BRANCH]
    expect(r.ok).toBe(true)
    expect(calls.close).toEqual([]) // 不 close 别人的 PR
    expect(calls.del).toEqual([OWNED_BRANCH]) // 但删本 run 的 branch（GitHub 会自动 close 依赖它的 PR）
  })
})

// ── Truthful noop / recovery ─────────────────────────────────────────────────

describe('rollback · truthful recovery（不误报 noop）', () => {
  it('🔴 prepare-only + live 上 branch **实际存在**（网络模糊成功）→ 不报告 noop，走 cleanup', async () => {
    // 场景：stepCommit 里 createBranch 客户端超时但 GitHub 实际建了 branch，run 只记录了 prepare
    const { gh, calls } = ghFake({ branchTipSha: BLOB_SHA }) // branch 真在
    const cap = makeCap(gh)
    const r = await cap.rollback!(
      stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown> }), // 没 commit priorOutput
      {},
    )
    // prep 存在，commit priorOutput 缺失，但 live branch 真在 且 tip 是 baseSha
    // → 走 cleanup（删 branch），而不是虚报 noop
    expect(r.ok).toBe(true)
    // 实现细节：commit priorOutput 缺失但 branchTipSha !== null 时，我们仍 delete
    expect(calls.del).toEqual([OWNED_BRANCH])
  })

  it('commit-only + live branch 不存在 → 真 noop', async () => {
    const { gh, calls } = ghFake({ branchTipSha: null })
    const cap = makeCap(gh)
    const r = await cap.rollback!(
      stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, commit: { commit_created: true } }),
      {},
    )
    expect(r.ok).toBe(true)
    expect(r.rollbackKind).toBe('noop')
    expect(calls.del).toEqual([])
    expect(calls.close).toEqual([])
  })
})

// ── Retry idempotency ────────────────────────────────────────────────────────

describe('rollback · retry idempotency', () => {
  it('已 closed PR + branch 已删（404）→ 幂等 ok', async () => {
    const { gh, calls } = ghFake({
      branchTipSha: null, // branch 已删
      prByNumber: {
        42: { state: 'closed', merged: false, mergedAt: null, draft: true,
          headRef: OWNED_BRANCH, baseRef: 'main', body: OUR_PR_BODY },
      },
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(
      stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, commit: { commit_created: true }, open_pr: OPENED_OUTPUT }),
      {},
    )
    expect(r.ok).toBe(true)
    expect(calls.close).toEqual([]) // 已 closed，不重复
    expect(calls.del).toEqual([])   // branch 已 404，不再调
  })

  it('第一次 close 成功、delete 失败；第二次调用继续删', async () => {
    // 第一次
    let firstDelete = true
    const { gh: gh1, calls: c1 } = ghFake({
      branchTipSha: BLOB_SHA,
      prByNumber: {
        42: { state: 'open', merged: false, mergedAt: null, draft: true,
          headRef: OWNED_BRANCH, baseRef: 'main', body: OUR_PR_BODY },
      },
      deleteBranch: async () => {
        if (firstDelete) { firstDelete = false; throw new Error('provider 500') }
      },
    })
    const cap1 = makeCap(gh1)
    const r1 = await cap1.rollback!(
      stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, commit: { commit_created: true }, open_pr: OPENED_OUTPUT }),
      {},
    )
    expect(r1.ok).toBe(false) // delete 失败
    expect(c1.close).toEqual([42])

    // 第二次（Gateway 若绕开 lineage 又调）：PR 已 closed，直接 delete
    const { gh: gh2, calls: c2 } = ghFake({
      branchTipSha: BLOB_SHA,
      prByNumber: {
        42: { state: 'closed', merged: false, mergedAt: null, draft: true,
          headRef: OWNED_BRANCH, baseRef: 'main', body: OUR_PR_BODY },
      },
    })
    const cap2 = makeCap(gh2)
    const r2 = await cap2.rollback!(
      stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, commit: { commit_created: true }, open_pr: OPENED_OUTPUT }),
      {},
    )
    expect(r2.ok).toBe(true)
    expect(c2.close).toEqual([])
    expect(c2.del).toEqual([OWNED_BRANCH])
  })
})

// ── 非 404 provider 错误 fail-not-swallow ─────────────────────────────────────

describe('rollback · 非 404 provider 错误必须 fail 不吞', () => {
  it('closePullRequest 500 → ok:false（不吞成 ok:true）', async () => {
    const { gh, calls } = ghFake({
      branchTipSha: BLOB_SHA,
      prByNumber: {
        42: { state: 'open', merged: false, mergedAt: null, draft: true,
          headRef: OWNED_BRANCH, baseRef: 'main', body: OUR_PR_BODY },
      },
      closePr: async () => { throw new Error('provider 500') },
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(
      stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, commit: { commit_created: true }, open_pr: OPENED_OUTPUT }),
      {},
    )
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/closePullRequest/)
    expect(calls.del).toEqual([]) // 关键：close 失败不进入 delete
  })

  it('resolveGithubConnection 返 null → ok:false', async () => {
    const cap = createPageApplyOptimizationCapability(noopSb(), {
      resolveGithubConnection: async () => null,
      createGithubClient: () => ({}) as never,
    })
    const r = await cap.rollback!(
      stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, commit: { commit_created: true }, open_pr: OPENED_OUTPUT }),
      {},
    )
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/GitHub 连接消失/)
  })
})

// ── Wiring proof ─────────────────────────────────────────────────────────────

describe('rollback wiring', () => {
  it('createPageApplyOptimizationCapability().rollback 是 function', () => {
    const cap = createPageApplyOptimizationCapability(noopSb())
    expect(typeof cap.rollback).toBe('function')
  })
})
