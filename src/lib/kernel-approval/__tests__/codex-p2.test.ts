/**
 * Codex 第一轮四条 P2 的回归闸（PR #962）。
 *
 * 每一条都单独一个 describe，坏掉时的失败信息要能一眼看出是哪一条回退了。
 *
 *   P2-1 权限查询**失败**不许被伪装成「你没权限」
 *   P2-2 审批请求必须真的属于这条 run、这个客户（否则跨客户元数据泄露）
 *   P2-3 表在但 RPC 不在 → 仍然是 503 kernel_not_provisioned，不是 500
 *   P2-4 列表截断不许静默，且等得最久的排最前（防饿死）
 */

import { describe, it, expect, vi } from 'vitest'
import { runAction } from '@/lib/kernel/runner'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { createCapabilities, computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import {
  makeFixture,
  CLIENT_A,
  CLIENT_B,
  GOAL_A,
  POST_A,
  BLOG_DRAFT,
} from '@/lib/kernel/__tests__/fixtures'
import { ApprovalError } from '../errors'
import {
  buildApprovalDetail,
  decideApproval,
  listPendingApprovals,
  loadRunForApproval,
} from '../service'
import {
  clampPageSize,
  listPendingRunsForClient,
  PENDING_APPROVAL_MAX_PAGE_SIZE,
  PENDING_APPROVAL_PAGE_SIZE,
} from '../queries'

const KEY = 'seo.build_publish_package'
const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)
const APPROVAL_POLICY = { action_key: KEY, mode: 'require_approval', spend_cap_per_run_usd: 0 }
const ACTOR = 'ray@magiclab'

function submit() {
  return {
    clientId: CLIENT_A,
    actionKey: KEY,
    purpose: 'growth' as const,
    goalId: GOAL_A,
    triggeredBy: 'schedule' as const,
    input: { blog_post_id: POST_A, content_hash: HASH },
  }
}

async function pendingFixture(supabaseOptions: Record<string, unknown> = {}) {
  const f = makeFixture({
    registry: ACTION_REGISTRY,
    capabilities: (sb) => ({ [KEY]: createCapabilities(sb)[KEY] }),
    options: { policy: APPROVAL_POLICY, supabaseOptions },
  })
  const pending = await runAction(f.kernel, submit())
  expect(pending.kind).toBe('pending_approval')
  const run = f.tables.action_runs[0]
  return { f, runId: String(run.id), expectedDecisionId: String(run.authorization_decision_id) }
}

// ── P2-2 ─────────────────────────────────────────────────────────────────────

describe('🔴 Codex P2-2 · 审批请求必须真的属于这条 run 和这个客户', () => {
  it('指针挂到**另一个客户**那条决策上 → 详情拒绝，不把对方的理由吐出来', async () => {
    const { f, runId } = await pendingFixture()

    // 造一条属于 B 客户、别的 run 的 require_approval 决策，并把 A 的 run 错挂过去
    f.tables.authorization_decisions.push({
      id: '0d000000-0000-4000-8000-0000000000cb',
      action_run_id: '40000000-0000-4000-8000-0000000000cb',
      client_id: CLIENT_B,
      verdict: 'require_approval',
      reason: 'B 客户的机密理由：给 xxx 投 $4000',
      policy_id: '901c0000-0000-4000-8000-0000000000cb',
      policy_version: 7,
      created_at: '2026-08-13T00:00:00.000Z',
    })
    f.tables.action_runs[0].authorization_decision_id = '0d000000-0000-4000-8000-0000000000cb'

    const run = await loadRunForApproval(f.supabase, runId)
    const err = await buildApprovalDetail(f.supabase, run).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApprovalError)
    expect((err as ApprovalError).code).toBe('not_pending')
    expect(
      JSON.stringify(err),
      '🔴 另一个客户的理由 / 政策版本一个字都不许出现在返回体里',
    ).not.toContain('B 客户的机密理由')
  })

  it('🔴 决策自称是**这条 run** 的，但 client_id 是另一个客户 → 一样拒绝', async () => {
    // 🔴 这条专门盯「客户」那一半判据。
    //    上一条用例里 action_run_id 和 client_id 一起改了，所以只要 run 那一半还在，
    //    客户那一半被删掉也不会红 —— 那就是一道被遮蔽的闸。
    //    这里让 action_run_id **对得上**，只有 client_id 不对，把它单独暴露出来。
    //    （Kernel 的 reuseLiveAuthorization 对同一形状抛 CROSS_CLIENT。）
    const { f, runId } = await pendingFixture()
    f.tables.authorization_decisions.push({
      id: '0d000000-0000-4000-8000-00000000c1a1',
      action_run_id: runId,
      client_id: CLIENT_B,
      verdict: 'require_approval',
      reason: 'B 客户的机密理由：给 xxx 投 $4000',
      policy_id: '901c0000-0000-4000-8000-0000000000cb',
      policy_version: 7,
      created_at: '2026-08-13T00:00:00.000Z',
    })
    f.tables.action_runs[0].authorization_decision_id = '0d000000-0000-4000-8000-00000000c1a1'

    const run = await loadRunForApproval(f.supabase, runId)
    const err = await buildApprovalDetail(f.supabase, run).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApprovalError)
    expect((err as ApprovalError).code).toBe('not_pending')
    expect(JSON.stringify(err)).not.toContain('B 客户的机密理由')

    // 列表侧同样
    const { items, skippedRunIds } = await listPendingApprovals(f.supabase, CLIENT_A)
    expect(items).toEqual([])
    expect(skippedRunIds).toHaveLength(1)
  })

  it('指针挂到**同客户但另一条 run** 的决策上 → 一样拒绝', async () => {
    const { f, runId } = await pendingFixture()
    f.tables.authorization_decisions.push({
      id: '0d000000-0000-4000-8000-00000000a107',
      action_run_id: '40000000-0000-4000-8000-00000000a107',
      client_id: CLIENT_A,
      verdict: 'require_approval',
      reason: '另一件事的理由',
      policy_id: '901c0000-0000-4000-8000-000000000001',
      policy_version: 1,
      created_at: '2026-08-13T00:00:00.000Z',
    })
    f.tables.action_runs[0].authorization_decision_id = '0d000000-0000-4000-8000-00000000a107'

    const run = await loadRunForApproval(f.supabase, runId)
    await expect(buildApprovalDetail(f.supabase, run)).rejects.toMatchObject({
      code: 'not_pending',
    })
  })

  it('列表侧同样拦：错挂的那条进 skipped，不冒充一条能点的待办', async () => {
    const { f } = await pendingFixture()
    f.tables.authorization_decisions.push({
      id: '0d000000-0000-4000-8000-0000000000cb',
      action_run_id: '40000000-0000-4000-8000-0000000000cb',
      client_id: CLIENT_B,
      verdict: 'require_approval',
      reason: 'B 客户的机密理由',
      policy_id: '901c0000-0000-4000-8000-0000000000cb',
      policy_version: 7,
      created_at: '2026-08-13T00:00:00.000Z',
    })
    f.tables.action_runs[0].authorization_decision_id = '0d000000-0000-4000-8000-0000000000cb'

    const { items, skippedRunIds } = await listPendingApprovals(f.supabase, CLIENT_A)
    expect(items).toEqual([])
    expect(skippedRunIds).toHaveLength(1)
  })

  it('🔴 **拒绝的写路径**同样拦：错挂到另一个客户的决策拒不掉，也不抄它的政策版本', async () => {
    // 🔴 早先只有列表和详情这两条**读**路径过归属核对 —— 于是一条
    //    client_id 属于别人的错挂决策「读不出来但拒得掉」，
    //    而新签的 deny 会把对方的 policy_id / 版本抄进这个客户的审计记录。
    const { f, runId } = await pendingFixture()
    f.tables.authorization_decisions.push({
      id: '0d000000-0000-4000-8000-00000000c1a1',
      action_run_id: runId, // 🔴 run 对得上，只有客户不对
      client_id: CLIENT_B,
      action_key: KEY,
      action_version: 1,
      idempotency_key: 'whatever',
      verdict: 'require_approval',
      reason: 'B 客户的机密理由',
      policy_id: '901c0000-0000-4000-8000-0000000000cb',
      policy_version: 7,
      created_at: '2026-08-13T00:00:00.000Z',
    })
    f.tables.action_runs[0].authorization_decision_id = '0d000000-0000-4000-8000-00000000c1a1'
    const before = f.tables.authorization_decisions.length

    const err = await decideApproval(f.kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: {
        resolution: 'reject',
        expectedDecisionId: '0d000000-0000-4000-8000-00000000c1a1',
        reason: '不做',
      },
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApprovalError)
    expect((err as ApprovalError).code).toBe('not_pending')
    expect(f.tables.authorization_decisions, '一条决策都不许新签').toHaveLength(before)
    expect(f.tables.action_runs[0].status).toBe('pending_approval')
    expect(
      JSON.stringify(f.tables.authorization_decisions),
      '另一个客户的政策版本不许被抄进任何新记录',
    ).not.toContain('"policy_version":7,"decided_by":"human"')
  })

  it('🔴 数据库那道也拦（应用层那道拆了也守得住）', async () => {
    // 直接打 RPC —— 绕过应用层的前置校验，验的是锁内那道 pending_identity_mismatch。
    const { f, runId } = await pendingFixture()
    f.tables.authorization_decisions.push({
      id: '0d000000-0000-4000-8000-00000000c1a2',
      action_run_id: runId,
      client_id: CLIENT_B,
      action_key: KEY,
      action_version: 1,
      idempotency_key: 'whatever',
      verdict: 'require_approval',
      reason: 'B 客户的机密理由',
      policy_id: '901c0000-0000-4000-8000-0000000000cb',
      policy_version: 7,
      created_at: '2026-08-13T00:00:00.000Z',
    })
    f.tables.action_runs[0].authorization_decision_id = '0d000000-0000-4000-8000-00000000c1a2'

    const { data } = await (f.supabase as unknown as {
      rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: Array<{ ok: boolean; reason: string }> }>
    }).rpc('kernel_resolve_pending_approval', {
      p_run_id: runId,
      p_pending_decision_id: '0d000000-0000-4000-8000-00000000c1a2',
      p_resolution: 'reject',
      p_resolved_by: ACTOR,
      p_reason: '不做',
      p_policy_snapshot: {},
      p_cost_estimate_usd: null,
    })
    expect(data[0].ok).toBe(false)
    expect(data[0].reason).toBe('pending_identity_mismatch')
  })

  it('✅ 正常挂着自己那条的时候照常返回（判据不是把所有人都拦掉）', async () => {
    const { f, runId, expectedDecisionId } = await pendingFixture()
    const detail = await buildApprovalDetail(f.supabase, await loadRunForApproval(f.supabase, runId))
    expect(detail.decision.id).toBe(expectedDecisionId)
  })
})

describe('🔴 Codex round 2 · 版本对不上时不许拿新版定义顶替', () => {
  it('列表和详情都不贴新版的标题 / 风险 / 副作用 / 门槛', async () => {
    const { f, runId } = await pendingFixture()
    // 契约升版：库里那条 run 记的还是旧版
    f.tables.action_runs[0].action_version = 99

    const { items } = await listPendingApprovals(f.supabase, CLIENT_A)
    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item.actionVersion, '如实回报 run 自己记的版本').toBe(99)
    expect(item.title, '不许把新版标题贴在旧请求上').toBeNull()
    expect(item.risk).toBeNull()
    expect(item.sideEffect).toBeNull()
    expect(item.requiredCapabilityTier, '门槛说不清就是 null，不拿新版的顶').toBeNull()

    const detail = await buildApprovalDetail(
      f.supabase,
      await loadRunForApproval(f.supabase, runId),
    )
    expect(detail.title).toBeNull()
    expect(detail.requiredCapabilityTier).toBeNull()
  })
})

// ── P2-3 ─────────────────────────────────────────────────────────────────────

describe('🔴 Codex P2-3 · 表在但 RPC 不在 → 仍然是 503，不是 500', () => {
  it('提交决定时 RPC 缺失 → kernel_not_provisioned', async () => {
    const { f, runId, expectedDecisionId } = await pendingFixture()
    // 表全都读得到（前面的 loadRun 就是证据），只有这个函数不存在
    const kernel = {
      ...f.kernel,
      supabase: {
        ...f.supabase,
        rpc: async () => ({
          data: null,
          error: {
            code: '42883',
            message:
              'function public.kernel_resolve_pending_approval(uuid, uuid, text, text, text, jsonb, numeric) does not exist',
          },
        }),
      },
    } as unknown as typeof f.kernel

    const run = await loadRunForApproval(f.supabase, runId)
    const err = await decideApproval(kernel, {
      run,
      actorEmail: ACTOR,
      input: { resolution: 'approve', expectedDecisionId },
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApprovalError)
    expect((err as ApprovalError).code).toBe('kernel_not_provisioned')
    expect((err as ApprovalError).status).toBe(503)
    // 什么都没被改动
    expect(f.tables.action_runs[0].status).toBe('pending_approval')
    expect(
      f.tables.authorization_decisions.filter((d) => d.decided_by === 'human'),
    ).toHaveLength(0)
  })

  it('🔴 别的 RPC 失败仍然是 500 —— 不许把任意故障都说成「还没启用」', async () => {
    const { f, runId, expectedDecisionId } = await pendingFixture()
    const kernel = {
      ...f.kernel,
      supabase: {
        ...f.supabase,
        rpc: async () => ({
          data: null,
          error: { code: '57014', message: 'canceling statement due to statement timeout' },
        }),
      },
    } as unknown as typeof f.kernel

    const err = await decideApproval(kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: { resolution: 'approve', expectedDecisionId },
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(ApprovalError)
    expect(String((err as Error).message)).toContain('statement timeout')
  })
})

// ── P2-4 ─────────────────────────────────────────────────────────────────────

/** 第 i 条种子 run 的 id。**合法 UUID** —— 真表里这一列就是 uuid。 */
const seededRunId = (i: number): string =>
  `40000000-0000-4000-8000-${String(i).padStart(12, '0')}`

/** 直接往表里塞 N 条等审批的 run + 对应决策（不走 Kernel，快且可控时间戳）。 */
function seedPending(f: Awaited<ReturnType<typeof pendingFixture>>['f'], count: number) {
  f.tables.action_runs.length = 0
  f.tables.authorization_decisions.length = 0
  for (let i = 0; i < count; i++) {
    const runId = seededRunId(i)
    const decisionId = `0d000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    f.tables.authorization_decisions.push({
      id: decisionId,
      action_run_id: runId,
      client_id: CLIENT_A,
      verdict: 'require_approval',
      reason: `第 ${i} 条`,
      policy_id: '901c0000-0000-4000-8000-000000000001',
      policy_version: 1,
      created_at: '2026-08-01T00:00:00.000Z',
    })
    f.tables.action_runs.push({
      id: runId,
      client_id: CLIENT_A,
      purpose: 'growth',
      goal_id: null,
      action_key: KEY,
      action_version: 1,
      input: {},
      rationale: null,
      evidence: {},
      status: 'pending_approval',
      authorization_decision_id: decisionId,
      cost_cap_usd: 0,
      cost_estimate_usd: 0,
      // 🔴 i 越小时间越早 = 等得越久
      updated_at: `2026-08-0${1 + Math.floor(i / 100)}T00:${String(i % 60).padStart(2, '0')}:00.000Z`,
      created_at: '2026-08-01T00:00:00.000Z',
    })
  }
}

describe('🔴 Codex P2-4 · 列表截断不许静默，等得最久的排最前', () => {
  it('条数没超过一页 → hasMore 是 false', async () => {
    const { f } = await pendingFixture()
    seedPending(f, 3)
    const page = await listPendingApprovals(f.supabase, CLIENT_A)
    expect(page.items).toHaveLength(3)
    expect(page.hasMore).toBe(false)
  })

  it('🔴 超过一页 → hasMore 是 true（截断被说出来了，不是静静少给）', async () => {
    const { f } = await pendingFixture()
    seedPending(f, PENDING_APPROVAL_PAGE_SIZE + 7)
    const page = await listPendingApprovals(f.supabase, CLIENT_A)
    expect(page.items).toHaveLength(PENDING_APPROVAL_PAGE_SIZE)
    expect(page.hasMore, '截断了却说 hasMore=false，界面会当成「就这么多」').toBe(true)
    expect(page.limit).toBe(PENDING_APPROVAL_PAGE_SIZE)
    expect(page.nextCursor, '还有后续就必须给游标').toBeTruthy()
  })

  it('🔴 等得最久的排最前 —— 新的挤不掉老的（防饿死）', async () => {
    const { f } = await pendingFixture()
    seedPending(f, PENDING_APPROVAL_PAGE_SIZE + 7)
    const page = await listPendingApprovals(f.supabase, CLIENT_A)
    expect(page.items[0].runId, '第一条必须是等得最久的那一条').toBe(seededRunId(0))
    expect(page.items[1].runId).toBe(seededRunId(1))
    // 🔴 被截掉的必须是**最新的**那几条，不是最老的
    expect(page.items.map((i) => i.runId)).not.toContain(seededRunId(56))
  })

  it('🔴 排序真的按「先时间、平手再 id」—— 主键不许被第二排序键顶掉', async () => {
    // 🔴 这条盯的是**假件的多列排序建模**，不是业务逻辑。
    //    `.order()` 如果只保留最后一次调用，`updated_at` 主键就会被 `id` 顶掉，
    //    于是上面那条「等得最久排最前」的用例在时间与 id 同向时**恰好也能过**，
    //    而排序判据其实整个失效了 —— 实测有一条变异探针因此完全抓不住。
    //    这里让时间与 id **反向**：只有主键真的生效才排得对。
    const { f } = await pendingFixture()
    f.tables.action_runs.length = 0
    f.tables.authorization_decisions.length = 0
    const order = [
      { id: '40000000-0000-4000-8000-0000000000zz'.replace('zz','ff'), updated_at: '2026-08-01T00:00:00.000Z' }, // 最老 → 应排第一
      { id: '40000000-0000-4000-8000-0000000000aa', updated_at: '2026-08-09T00:00:00.000Z' }, // 最新 → 应排最后
    ]
    for (const { id, updated_at } of order) {
      f.tables.authorization_decisions.push({
        id: `dec-${id}`,
        action_run_id: id,
        client_id: CLIENT_A,
        verdict: 'require_approval',
        reason: '',
        policy_id: '901c0000-0000-4000-8000-000000000001',
        policy_version: 1,
        created_at: updated_at,
      })
      f.tables.action_runs.push({
        id,
        client_id: CLIENT_A,
        purpose: 'growth',
        goal_id: null,
        action_key: KEY,
        action_version: 1,
        input: {},
        rationale: null,
        evidence: {},
        status: 'pending_approval',
        authorization_decision_id: `dec-${id}`,
        cost_cap_usd: 0,
        cost_estimate_usd: 0,
        updated_at,
        created_at: updated_at,
      })
    }

    const page = await listPendingApprovals(f.supabase, CLIENT_A)
    expect(
      page.items.map((i) => i.runId),
      '排序必须由 updated_at 说了算 —— 按 id 排的话 …aa 会跑到前面',
    ).toEqual([
      '40000000-0000-4000-8000-0000000000ff',
      '40000000-0000-4000-8000-0000000000aa',
    ])
  })

  it('🔴 时间戳撞在一起时，id 作为第二排序键给出稳定总序（翻页不跳条的前提）', async () => {
    const { f } = await pendingFixture()
    f.tables.action_runs.length = 0
    f.tables.authorization_decisions.length = 0
    const SAME_TIME = '2026-08-05T00:00:00.000Z'
    for (const id of [
      '40000000-0000-4000-8000-0000000000c0',
      '40000000-0000-4000-8000-0000000000a0',
      '40000000-0000-4000-8000-0000000000b0',
    ]) {
      f.tables.authorization_decisions.push({
        id: `dec-${id}`,
        action_run_id: id,
        client_id: CLIENT_A,
        verdict: 'require_approval',
        reason: '',
        policy_id: '901c0000-0000-4000-8000-000000000001',
        policy_version: 1,
        created_at: SAME_TIME,
      })
      f.tables.action_runs.push({
        id,
        client_id: CLIENT_A,
        purpose: 'growth',
        goal_id: null,
        action_key: KEY,
        action_version: 1,
        input: {},
        rationale: null,
        evidence: {},
        status: 'pending_approval',
        authorization_decision_id: `dec-${id}`,
        cost_cap_usd: 0,
        cost_estimate_usd: 0,
        updated_at: SAME_TIME,
        created_at: SAME_TIME,
      })
    }
    const page = await listPendingApprovals(f.supabase, CLIENT_A)
    expect(page.items.map((i) => i.runId)).toEqual([
      '40000000-0000-4000-8000-0000000000a0',
      '40000000-0000-4000-8000-0000000000b0',
      '40000000-0000-4000-8000-0000000000c0',
    ])
  })

  it('🔴 游标能真的翻到后面去，而且不跳条不重条', async () => {
    const { f } = await pendingFixture()
    const total = 25
    seedPending(f, total)
    const first = await listPendingApprovals(f.supabase, CLIENT_A, { limit: 10 })
    const second = await listPendingApprovals(f.supabase, CLIENT_A, {
      limit: 10,
      cursor: first.nextCursor,
    })
    const third = await listPendingApprovals(f.supabase, CLIENT_A, {
      limit: 10,
      cursor: second.nextCursor,
    })

    expect(first.items).toHaveLength(10)
    expect(first.hasMore).toBe(true)
    expect(second.items).toHaveLength(10)
    expect(second.hasMore).toBe(true)
    expect(third.items).toHaveLength(5)
    expect(third.hasMore, '最后一页不许再说「后面还有」').toBe(false)
    expect(third.nextCursor, '没有下一页就不许给游标').toBeNull()

    const seen = [...first.items, ...second.items, ...third.items].map((i) => i.runId)
    expect(new Set(seen).size, '翻完三页不许有重复').toBe(total)
    expect(seen).toEqual(Array.from({ length: total }, (_, i) => seededRunId(i)))
  })

  it('🔴 翻页期间第一页那些被处理掉 → 第二页仍然不跳条（offset 会跳，游标不会）', async () => {
    // 🔴 这条就是 offset 分页挂掉的那个形状：待审批是**活的**队列，
    //    第一页那 10 条被别人处理掉之后，结果集整体左移；
    //    `offset=10` 会从缩短后的集合再跳过 10 行 —— 紧接着的第 11~20 条
    //    一条都不会被返回，而调用方毫不知情。
    //    游标是按**值**定位的（「排在 (t,id) 之后的那些」），位移根本不存在。
    const { f } = await pendingFixture()
    const total = 25
    seedPending(f, total)

    const first = await listPendingApprovals(f.supabase, CLIENT_A, { limit: 10 })
    expect(first.items.map((i) => i.runId)).toEqual(
      Array.from({ length: 10 }, (_, i) => seededRunId(i)),
    )

    // 第一页那 10 条全被处理掉了（退出 pending_approval 过滤集）
    const donePage = new Set(first.items.map((i) => i.runId))
    for (const run of f.tables.action_runs) {
      if (donePage.has(String(run.id))) run.status = 'authorized'
    }

    const second = await listPendingApprovals(f.supabase, CLIENT_A, {
      limit: 10,
      cursor: first.nextCursor,
    })
    expect(
      second.items.map((i) => i.runId),
      '第二页必须紧接着第一页 —— 一条都不许被跳过',
    ).toEqual(Array.from({ length: 10 }, (_, i) => seededRunId(i + 10)))
  })

  it('🔴 游标读不成就当没给（当成某个位置会跳条）', async () => {
    const { f } = await pendingFixture()
    seedPending(f, 5)
    for (const cursor of ['', 'garbage', '|', 'not-a-date|' + seededRunId(0), '2026-08-01T00:00:00.000Z|not-a-uuid', 42, null, {}]) {
      const page = await listPendingApprovals(f.supabase, CLIENT_A, { limit: 3, cursor })
      expect(page.items[0]?.runId, `游标「${String(cursor)}」应当被忽略并从头给`).toBe(seededRunId(0))
    }
  })

  it('🔴 已经翻过去的行不许倒回来（游标的两段必须是「与」，不是各管各的）', async () => {
    // 🔴 这条专门区分一种**看起来等价**的写坏法：把
    //      `updated_at.gt.T , and(updated_at.eq.T , id.gt.I)`
    //    退化成两个各自独立的条件（例如假件把嵌套 and 按逗号劈开）。
    //    时间与 id 同向时两者结果一样 —— 所以光有前面那些用例抓不住。
    //    这里让**时间早的那一行 id 反而更大**：退化版的 `id > I` 会把
    //    一条**早就翻过去的**行重新捞回来，而正确的下一行永远出不来。
    const { f } = await pendingFixture()
    f.tables.action_runs.length = 0
    f.tables.authorization_decisions.length = 0
    const rows = [
      { id: '40000000-0000-4000-8000-0000000000ff', at: '2026-08-01T00:00:00.000Z' }, // 最老，id 最大
      { id: '40000000-0000-4000-8000-0000000000aa', at: '2026-08-02T00:00:00.000Z' },
      { id: '40000000-0000-4000-8000-0000000000bb', at: '2026-08-03T00:00:00.000Z' },
    ]
    rows.forEach(({ id, at }, i) => {
      const decisionId = `0d000000-0000-4000-8000-${String(i).padStart(12, '0')}`
      f.tables.authorization_decisions.push({
        id: decisionId,
        action_run_id: id,
        client_id: CLIENT_A,
        verdict: 'require_approval',
        reason: '',
        policy_id: '901c0000-0000-4000-8000-000000000001',
        policy_version: 1,
        created_at: at,
      })
      f.tables.action_runs.push({
        id,
        client_id: CLIENT_A,
        purpose: 'growth',
        goal_id: null,
        action_key: KEY,
        action_version: 1,
        input: {},
        rationale: null,
        evidence: {},
        status: 'pending_approval',
        authorization_decision_id: decisionId,
        cost_cap_usd: 0,
        cost_estimate_usd: 0,
        updated_at: at,
        created_at: at,
      })
    })

    const p1 = await listPendingApprovals(f.supabase, CLIENT_A, { limit: 1 })
    expect(p1.items.map((i) => i.runId)).toEqual([rows[0].id])

    const p2 = await listPendingApprovals(f.supabase, CLIENT_A, { limit: 1, cursor: p1.nextCursor })
    expect(p2.items.map((i) => i.runId)).toEqual([rows[1].id])

    const p3 = await listPendingApprovals(f.supabase, CLIENT_A, { limit: 1, cursor: p2.nextCursor })
    expect(
      p3.items.map((i) => i.runId),
      '第三页必须是第三行 —— 不许把已经翻过去的第一行倒回来',
    ).toEqual([rows[2].id])

    const seen = [...p1.items, ...p2.items, ...p3.items].map((i) => i.runId)
    expect(new Set(seen).size, '翻完不许有重复').toBe(3)
  })

  it('🔴 时间戳撞在一起时游标不整批跳过同伴（第二段 and(...) 不能省）', async () => {
    const { f } = await pendingFixture()
    f.tables.action_runs.length = 0
    f.tables.authorization_decisions.length = 0
    const SAME = '2026-08-05T00:00:00.000Z'
    for (let i = 0; i < 4; i++) {
      const id = seededRunId(i)
      f.tables.authorization_decisions.push({
        id: `0d000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        action_run_id: id,
        client_id: CLIENT_A,
        verdict: 'require_approval',
        reason: '',
        policy_id: '901c0000-0000-4000-8000-000000000001',
        policy_version: 1,
        created_at: SAME,
      })
      f.tables.action_runs.push({
        id,
        client_id: CLIENT_A,
        purpose: 'growth',
        goal_id: null,
        action_key: KEY,
        action_version: 1,
        input: {},
        rationale: null,
        evidence: {},
        status: 'pending_approval',
        authorization_decision_id: `0d000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        cost_cap_usd: 0,
        cost_estimate_usd: 0,
        updated_at: SAME,
        created_at: SAME,
      })
    }
    const first = await listPendingApprovals(f.supabase, CLIENT_A, { limit: 2 })
    const second = await listPendingApprovals(f.supabase, CLIENT_A, {
      limit: 2,
      cursor: first.nextCursor,
    })
    expect(first.items.map((i) => i.runId)).toEqual([seededRunId(0), seededRunId(1)])
    expect(
      second.items.map((i) => i.runId),
      '只比时间的话，撞在游标那一刻的同伴会被整批跳过',
    ).toEqual([seededRunId(2), seededRunId(3)])
  })

  it('页大小夹在 [1, MAX]，给的不是正整数就用默认值（不当成无上限）', () => {
    expect(clampPageSize(undefined)).toBe(PENDING_APPROVAL_PAGE_SIZE)
    expect(clampPageSize(0)).toBe(PENDING_APPROVAL_PAGE_SIZE)
    expect(clampPageSize(-5)).toBe(PENDING_APPROVAL_PAGE_SIZE)
    expect(clampPageSize(Number.NaN)).toBe(PENDING_APPROVAL_PAGE_SIZE)
    expect(clampPageSize('abc')).toBe(PENDING_APPROVAL_PAGE_SIZE)
    expect(clampPageSize(Number.POSITIVE_INFINITY)).toBe(PENDING_APPROVAL_PAGE_SIZE)
    expect(clampPageSize(7)).toBe(7)
    expect(clampPageSize(10_000)).toBe(PENDING_APPROVAL_MAX_PAGE_SIZE)
  })

  it('🔴 分页查询照样只看这一个客户', async () => {
    const { f } = await pendingFixture()
    seedPending(f, 5)
    const page = await listPendingRunsForClient(f.supabase, CLIENT_B, { limit: 10 })
    expect(page.runs).toEqual([])
    expect(page.hasMore).toBe(false)
  })
})

// ── Codex 对 #961 那一轮另外两条（机器人已发现，这里按正确方式修 + 盯住） ──────

describe('🔴 批准时写的备注不许被静默丢弃', () => {
  it('approve 带 reason → 落进 append-only 决策记录', async () => {
    const { f, runId, expectedDecisionId } = await pendingFixture()
    await decideApproval(f.kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: { resolution: 'approve', expectedDecisionId, reason: '跟客户电话确认过了' },
    })
    const allow = f.tables.authorization_decisions.find(
      (d) => d.verdict === 'allow' && d.decided_by === 'human',
    )!
    expect(
      String(allow.reason),
      '接口按契约收下了这段话，审计表里必须找得到它 —— 否则就是静默丢弃',
    ).toContain('跟客户电话确认过了')
  })

  it('approve 不带 reason 时照常有自动生成的理由（不因此变空）', async () => {
    const { f, runId, expectedDecisionId } = await pendingFixture()
    await decideApproval(f.kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: { resolution: 'approve', expectedDecisionId },
    })
    const allow = f.tables.authorization_decisions.find(
      (d) => d.verdict === 'allow' && d.decided_by === 'human',
    )!
    expect(String(allow.reason)).toContain(ACTOR)
    expect(String(allow.reason).length).toBeGreaterThan(10)
  })
})

describe('🔴 批准的**失败落地**也要过指针闸（不许盖掉一份新的待审批请求）', () => {
  it('preflight 期间这条 run 被重新排成另一份请求 → 失败落地被 CAS 挡住，新请求毫发无损', async () => {
    // 形状：人点了同意 → preflight 读政策时发现政策没了（会走 recordDeny）——
    // 但就在这中间，系统把这条 run 重新排了一次，挂上了**另一份**待审批请求。
    // 只有状态闸的话，状态仍是 pending_approval，于是那份**新的、还没人看过的**
    // 请求会被这次迟到的「批不了」直接盖成 denied。
    // 🔴 钩子必须**等这条 run 真的挂起之后**才上膛：`runAction` 自己也要读政策，
    //    不上膛的话第一次触发发生在挂起之前，整条 run 直接被拒，测的就不是这件事了。
    let armed = false
    let swapped = false
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: (sb) => ({ [KEY]: createCapabilities(sb)[KEY] }),
      options: {
        policy: APPROVAL_POLICY,
        supabaseOptions: {
          beforeOp: (table, op) => {
            // 政策被读之后、落拒绝之前，插一脚把 run 重新排一次
            if (!armed || swapped || table !== 'client_automation_policies' || op !== 'select') return
            swapped = true
            f.tables.client_automation_policies.length = 0 // 让 preflight 失败
            const run = f.tables.action_runs[0]
            f.tables.authorization_decisions.push({
              ...f.tables.authorization_decisions.find(
                (d) => d.id === run.authorization_decision_id,
              )!,
              id: '0d000000-0000-4000-8000-0000000e1550',
            })
            run.authorization_decision_id = '0d000000-0000-4000-8000-0000000e1550'
          },
        },
      },
    })
    const pending = await runAction(f.kernel, submit())
    expect(pending.kind).toBe('pending_approval')
    const runId = String(f.tables.action_runs[0].id)
    const expectedDecisionId = String(f.tables.action_runs[0].authorization_decision_id)
    armed = true

    const err = await decideApproval(f.kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: { resolution: 'approve', expectedDecisionId },
    }).catch((e: unknown) => e)

    expect(swapped, '这条测试必须真的走到那个缝 —— 否则它什么都没验').toBe(true)
    expect(err).toBeInstanceOf(ApprovalError)
    expect((err as ApprovalError).code).toBe('stale_decision')

    // 🔴 那份新排的请求**毫发无损**：run 还停在等审批，指针还指着它
    expect(f.tables.action_runs[0].status).toBe('pending_approval')
    expect(f.tables.action_runs[0].authorization_decision_id).toBe('0d000000-0000-4000-8000-0000000e1550')
    expect(
      f.tables.authorization_decisions.filter((d) => d.verdict === 'deny'),
      '一条 deny 都不许落 —— 落了就等于把别人正在看的那件事替他否了',
    ).toHaveLength(0)
  })
})

// ── 一条保险：上面这些没把「正常路径」测坏 ───────────────────────────────────

describe('回归：正常审批链路仍然通', () => {
  it('同意 → authorized，一步都没跑', async () => {
    const capabilityCalls = vi.fn()
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: (sb) => {
        const impl = createCapabilities(sb)[KEY]
        return {
          [KEY]: {
            ...impl,
            steps: Object.fromEntries(
              Object.entries(impl.steps).map(([k, h]) => [
                k,
                async (s: Parameters<typeof h>[0]) => {
                  capabilityCalls()
                  return h(s)
                },
              ]),
            ),
          },
        }
      },
      options: { policy: APPROVAL_POLICY },
    })
    await runAction(f.kernel, submit())
    const runId = String(f.tables.action_runs[0].id)
    const expectedDecisionId = String(f.tables.action_runs[0].authorization_decision_id)

    const result = await decideApproval(f.kernel, {
      run: await loadRunForApproval(f.supabase, runId),
      actorEmail: ACTOR,
      input: { resolution: 'approve', expectedDecisionId },
    })
    expect(result.finalStatus).toBe('authorized')
    expect(capabilityCalls).not.toHaveBeenCalled()
    expect(f.tables.action_run_steps).toHaveLength(0)
  })
})
