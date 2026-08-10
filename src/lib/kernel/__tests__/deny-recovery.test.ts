/**
 * C3 —— 可恢复的 deny 必须能显式重新授权，其余的不许翻案。
 *
 * 背景：第一次因「客户没配规则」被拒后，人按待办去把规则配好了 ——
 * 但同样的输入再提交会命中同一把幂等键，直接拿回旧的 denied，永远好不了。
 *
 * 三条边界（对应实现 `recoverDeniedRun`）：
 *   ① 普通重复提交**不会**偷偷重新授权 —— 恢复必须是显式动作，带着谁、为什么；
 *   ② 旧 deny 决策原样保留（append-only），恢复是新签一条；
 *   ③ 只有白名单里的拒绝码能恢复：环境问题（没政策 / 过期 / 改过 / 超上限）能修好，
 *      提交本身的问题（参数不对 / 动作不认识 / 对外副作用）重授权一万次结论也一样。
 */

import { describe, it, expect, vi } from 'vitest'
import type { ActionDefinition } from '../types'
import { runAction, recoverDeniedRun, rejectPendingRun, RECOVERABLE_DENY_CODES } from '../runner'
import { ACTION_REGISTRY } from '../registry'
import { KernelError } from '../errors'
import { createCapabilities, computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import { makeFixture, makeRegistry, CLIENT_A, GOAL_A, POST_A, BLOG_DRAFT } from './fixtures'

const KEY = 'seo.build_publish_package'
const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)
const BASE = ACTION_REGISTRY.get(KEY) as ActionDefinition

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

function insertAutoPolicy(f: ReturnType<typeof makeFixture>) {
  f.tables.client_automation_policies.push({
    id: 'policy-late',
    client_id: CLIENT_A,
    action_key: KEY,
    mode: 'auto_approve',
    policy_version: 1,
    spend_cap_per_run_usd: 0,
    spend_cap_per_period_usd: null,
    spend_cap_period: null,
    decision_ttl_seconds: 900,
    effective_from: '2020-01-01T00:00:00.000Z',
    effective_to: null,
    updated_by: 'settings-ui',
  })
}

describe('C3 · no_policy → 配好规则 → 显式恢复', () => {
  it('🔴 完整恢复闭环：run id 不变、旧 deny 保留、capability 只执行一次', async () => {
    const builds = vi.fn()
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: (sb) => {
        const impl = createCapabilities(sb)[KEY]
        return {
          [KEY]: {
            ...impl,
            steps: {
              ...impl.steps,
              build: async (s: Parameters<(typeof impl.steps)['build']>[0]) => {
                builds()
                return impl.steps.build(s)
              },
            },
          },
        }
      },
      // 没有政策 → 第一次提交必然 no_policy
    })

    const denied = await runAction(f.kernel, submit())
    expect(denied.kind).toBe('denied')
    const denyDecisionId = String(f.tables.authorization_decisions[0].id)
    expect(f.tables.authorization_decisions[0].deny_code).toBe('no_policy')

    // 人按待办把规则配好了
    insertAutoPolicy(f)

    // ① 普通重复提交**不会**偷偷恢复
    const repeat = await runAction(f.kernel, submit())
    expect(repeat.kind).toBe('denied')
    expect(builds).not.toHaveBeenCalled()

    // ② 显式恢复
    const recovered = await recoverDeniedRun(f.kernel, denied.run.id, 'ray@magiclab', '规则已配好')

    expect(recovered.kind).toBe('succeeded')
    // run id 稳定 —— 恢复的是同一件事
    expect(recovered.run.id).toBe(denied.run.id)
    expect(f.tables.action_runs).toHaveLength(1)
    // capability 只执行一次
    expect(builds).toHaveBeenCalledTimes(1)
    expect(f.tables.production_packages).toHaveLength(1)
    // 旧 deny 决策原样保留，新 allow 是另一条
    const decisions = f.tables.authorization_decisions
    expect(decisions).toHaveLength(2)
    const oldDeny = decisions.find((d) => d.id === denyDecisionId)!
    expect(oldDeny.verdict).toBe('deny')
    expect(oldDeny.deny_code).toBe('no_policy')
    expect(decisions.at(-1)!.verdict).toBe('allow')
    // 恢复留痕：谁、什么时候、为什么、从哪个拒绝码恢复的
    const evidence = recovered.run.evidence as Record<string, unknown>
    expect(evidence.last_recovered_by).toBe('ray@magiclab')
    expect(evidence.recovery_reason).toBe('规则已配好')
    expect(evidence.recovered_from_deny_code).toBe('no_policy')
  })

  it('恢复后政策是 require_approval → 停在等人点头，不是直接跑', async () => {
    const f = makeFixture({ registry: ACTION_REGISTRY, capabilities: createCapabilities })
    const denied = await runAction(f.kernel, submit())

    f.tables.client_automation_policies.push({
      id: 'policy-late',
      client_id: CLIENT_A,
      action_key: KEY,
      mode: 'require_approval',
      policy_version: 1,
      spend_cap_per_run_usd: 0,
      spend_cap_per_period_usd: null,
      spend_cap_period: null,
      decision_ttl_seconds: 900,
      effective_from: '2020-01-01T00:00:00.000Z',
      effective_to: null,
      updated_by: 'settings-ui',
    })

    const recovered = await recoverDeniedRun(f.kernel, denied.run.id, 'ray@magiclab', '已配规则')
    expect(recovered.kind).toBe('pending_approval')
    expect(f.tables.production_packages).toHaveLength(0)
  })

  it('over_cost_cap → 上限被提高之后可恢复', async () => {
    const COSTLY: ActionDefinition = {
      ...BASE,
      // 声明「这个动作最多花 5」，并逐步说清上限 —— 硬上限要求说得出每步最多花多少。
      // （真实 capability 是零成本的，所以 actual 一定 <= 声明值。）
      costModel: {
        kind: 'estimated',
        estimate: () => 5,
        stepCeilingUsd: { build: 5, persist: 0, verify: 0 },
      },
    }
    const f = makeFixture({
      registry: makeRegistry([COSTLY]),
      capabilities: createCapabilities,
      options: { policy: { action_key: KEY, mode: 'auto_approve', spend_cap_per_run_usd: 1 } },
    })

    const denied = await runAction(f.kernel, submit())
    expect(denied.kind).toBe('denied')
    expect(f.tables.authorization_decisions[0].deny_code).toBe('over_cost_cap')

    // 客户把上限提到 10（走正常 update，版本触发器 bump —— 没关系，恢复走全新授权）
    await f.supabase
      .from('client_automation_policies')
      .update({ spend_cap_per_run_usd: 10 })
      .eq('id', 'policy-1')
      .select('id')

    const recovered = await recoverDeniedRun(f.kernel, denied.run.id, 'ray@magiclab', '上限已提高')
    expect(recovered.kind).toBe('succeeded')
  })
})

describe('C3 · 不可恢复的拒绝不许翻案', () => {
  it('invalid_input（参数不合契约）→ 恢复被拒', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: { action_key: KEY, mode: 'auto_approve', spend_cap_per_run_usd: 0 } },
    })
    const denied = await runAction(f.kernel, {
      ...submit(),
      input: { blog_post_id: POST_A, content_hash: HASH, sneaky_extra: 'x' },
    })
    expect(denied.kind).toBe('denied')
    expect(f.tables.authorization_decisions[0].deny_code).toBe('invalid_input')

    await expect(
      recoverDeniedRun(f.kernel, denied.run.id, 'ray@magiclab', '试试'),
    ).rejects.toThrow(/这次提交本身的问题/)
    expect(f.tables.action_runs[0].status).toBe('denied')
  })

  it('unknown_action → 恢复被拒（先实现动作，再重新排）', async () => {
    const f = makeFixture({ registry: ACTION_REGISTRY, capabilities: createCapabilities })
    const denied = await runAction(f.kernel, {
      ...submit(),
      actionKey: 'ads.some_future_action',
    })
    expect(f.tables.authorization_decisions[0].deny_code).toBe('unknown_action')

    await expect(
      recoverDeniedRun(f.kernel, denied.run.id, 'ray@magiclab', '试试'),
    ).rejects.toThrow(KernelError)
  })

  it('🔴 outward_side_effect_blocked → 恢复被拒（v1 的对外硬闸不给任何后门）', async () => {
    const OUTWARD: ActionDefinition = { ...BASE, sideEffect: 'outward' }
    const f = makeFixture({
      registry: makeRegistry([OUTWARD]),
      capabilities: createCapabilities,
      options: { policy: { action_key: KEY, mode: 'auto_approve', spend_cap_per_run_usd: 0 } },
    })
    const denied = await runAction(f.kernel, submit())
    expect(f.tables.authorization_decisions[0].deny_code).toBe('outward_side_effect_blocked')

    await expect(
      recoverDeniedRun(f.kernel, denied.run.id, 'ray@magiclab', '试试'),
    ).rejects.toThrow(/改条件救不了/)
  })

  it('🔴 人明确点过「不做」的 → 系统不替人改主意', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: { action_key: KEY, mode: 'require_approval' } },
    })
    const pending = await runAction(f.kernel, submit())
    const rejected = await rejectPendingRun(f.kernel, pending.run.id, 'ray@magiclab', '这周不做')
    expect(rejected.kind).toBe('denied')

    await expect(
      recoverDeniedRun(f.kernel, rejected.run.id, 'someone-else@magiclab', '我觉得该做'),
    ).rejects.toThrow(/不替人改主意/)
  })

  it('白名单是显式的：只有环境类拒绝码在里面', () => {
    expect(Array.from(RECOVERABLE_DENY_CODES).sort()).toEqual([
      'no_policy',
      'outward_requires_human_policy',
      'over_cost_cap',
      'policy_changed_since_request',
      'policy_expired',
    ])
  })
})

/**
 * K-WP02 · 对外动作被配成「自动执行」→ 改规则 → 显式恢复。
 *
 * 🔴 这一条防的是一个**永久锁死**：拒绝文案让人去把规则改成「要审批」，
 *    可幂等键会让同一件事命中旧的 denied run；如果那个拒绝码不可恢复，
 *    人照做了也永远做不了。所以「规则配错了」必须跟
 *    「动作定义本身不合规」用两个不同的码 —— 前者可恢复，后者不可。
 */
describe('K-WP02 · outward + auto_approve → 改成要审批 → 显式恢复', () => {
  const OUTWARD: ActionDefinition = {
    ...BASE,
    sideEffect: 'outward',
    reversible: true,
    providerIdempotency: 'supported',
    outwardAuthorization: {
      declaredIn: 'K-WP02 #882 (test-only definition)',
      requiresHumanApproval: true,
      rollback: 'snapshot_restore',
    },
    costModel: { kind: 'fixed', estimate: () => 0, stepCeilingUsd: { build: 0, persist: 0, verify: 0 } },
  }

  /**
   * 🔴 **端到端那一半暂时缺席，原因如实写在这里。**
   *
   * 恢复要过两道：应用层的 `RECOVERABLE_DENY_CODES`（已含新码）与
   * RPC `kernel_claim_run_recovery` 的白名单（migration 里已含新码）。
   * 但测试跑的是内存假件，而假件在 `fake-supabase.ts` 里还留着**第三份**
   * 硬编码的白名单 —— 它不在本 PR 授权的文件范围内，所以端到端那一步
   * （recoverDeniedRun → pending_approval）现在跑不通。
   *
   * 顺带暴露一个既有隐患：架构测试只盯 SQL ↔ runner.ts 两处，
   * **假件那第三份没有任何东西盯着**，它早就可能跟前两处分家。
   *
   * 下面这条只断言范围内能证明的部分：两个**权威**来源都认这个码。
   * 端到端闭环等假件那一行获批后补上。
   */
  it('🔴 两个权威来源都认这个码可恢复（SQL 侧由架构测试盯着一字不差）', () => {
    expect(RECOVERABLE_DENY_CODES.has('outward_requires_human_policy')).toBe(true)
    // 结构性不合规那个码必须**不在**里面 —— 两者的可恢复性刻意相反
    expect(RECOVERABLE_DENY_CODES.has('outward_side_effect_blocked')).toBe(false)
  })

  it('🔴 规则配错了 → 拒绝码精确，且 capability 零调用', async () => {
    const calls = vi.fn()
    const f = makeFixture({
      registry: makeRegistry([OUTWARD]),
      capabilities: () => ({
        [KEY]: {
          actionKey: KEY,
          version: 1,
          steps: {
            build: async () => {
              calls()
              return { output: {}, verification: null, costActualUsd: 0 }
            },
            persist: async () => {
              calls()
              return { output: {}, verification: null, costActualUsd: 0 }
            },
            verify: async () => {
              calls()
              return { output: {}, verification: null, costActualUsd: 0 }
            },
          },
        } as never,
      }),
      // ① 规则配错了：对外动作却配成「自动执行」
      options: { policy: { action_key: KEY, mode: 'auto_approve', spend_cap_per_run_usd: 100 } },
    })

    const denied = await runAction(f.kernel, submit())

    // ① 拒绝码必须**精确**是专用那个 —— 不是结构性的 outward_side_effect_blocked
    expect(denied.kind).toBe('denied')
    expect(f.tables.authorization_decisions[0].deny_code).toBe('outward_requires_human_policy')
    // ② capability 零调用
    expect(calls).not.toHaveBeenCalled()

    // ③ 应用层这一关已经放行了（真正卡住的是假件里那第三份白名单，见上面的说明）
    expect(RECOVERABLE_DENY_CODES.has(String(f.tables.authorization_decisions[0].deny_code))).toBe(
      true,
    )
  })

  it('🔴 结构性不合规（缺声明）用的仍是不可恢复的那个码', async () => {
    const f = makeFixture({
      registry: makeRegistry([{ ...OUTWARD, outwardAuthorization: null }]),
      capabilities: createCapabilities,
      options: { policy: { action_key: KEY, mode: 'require_approval', spend_cap_per_run_usd: 100 } },
    })

    const denied = await runAction(f.kernel, submit())
    expect(denied.kind).toBe('denied')
    expect(f.tables.authorization_decisions[0].deny_code).toBe('outward_side_effect_blocked')

    // 改条件救不了它 —— 动作定义本身不合规
    await expect(
      recoverDeniedRun(f.kernel, denied.run.id, 'ray@magiclab', '试试'),
    ).rejects.toThrow(/改条件救不了/)
  })
})
