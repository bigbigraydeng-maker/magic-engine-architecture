/**
 * T2 —— 开跑前那道预算闸必须结合「下一步要花多少」。
 * T3 —— capability 报回来的花费必须是一个**真实金额**，两层都拦。
 *
 * T2 要防的：已花 $2、上限 $2，下一步是收费的 —— 只判 `spent > cap` 的话
 * 这一步照跑，花成 $3 之后才发现超了。钱已经出去了，事后判没有意义。
 * 但也不能简单改成 `spent >= cap`：`cap = 0` 是正常值（零成本能力），
 * 那样会把它们全部拦死。判据必须是**还剩多少 vs 下一步最多花多少**。
 *
 * T3 要防的：NaN / ±Infinity / 负数进账本。负数最危险 ——
 * 它能把「已花金额」减回来，让同一笔预算被反复消费。
 */

import { describe, it, expect, vi } from 'vitest'
import type { ActionDefinition, CapabilityImplementation, CapabilityStepResult } from '../types'
import { runAction, resumeDeadLetterRun } from '../runner'
import { ACTION_REGISTRY } from '../registry'
import { createCapabilities, computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import { makeFixture, makeRegistry, CLIENT_A, GOAL_A, POST_A, BLOG_DRAFT } from './fixtures'

const KEY = 'seo.build_publish_package'
const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)

/** 合成动作：两步 a / b，可以逐步声明成本上界。 */
function definition(over: Partial<ActionDefinition> = {}): ActionDefinition {
  return {
    actionKey: KEY,
    version: 1,
    title: '会花钱的测试动作',
    inputSchema: { type: 'object', required: ['n'], properties: { n: { type: 'string' } }, additionalProperties: false },
    outputSchema: { type: 'object', required: ['done'], properties: { done: { type: 'boolean' } }, additionalProperties: true },
    capability: 'test',
    risk: 'low',
    sideEffect: 'internal_write',
    reversible: true,
    idempotency: { keyFields: ['n'], scope: 'client' },
    // 🔴 estimate 故意给一个**很小的正数**：
    //    给 0 的话「整个动作不花钱」那条兜底会顶上来，测不到「每步上界」这条路；
    //    给大数的话授权阶段那道估算闸（估 > 上限 → deny）会先拦，也测不到执行期。
    costModel: { kind: 'fixed', estimate: () => 0.01, stepCeilingUsd: { a: 2, b: 1 } },
    retryPolicy: { maxAttempts: 1, backoff: 'fixed', baseMs: 1 },
    verification: null,
    requiredCapabilityTier: 'paid_client',
    steps: ['a', 'b'],
    allowedPurposes: ['growth'],
    ...over,
  } as ActionDefinition
}

function capabilityOf(
  steps: Record<string, () => Promise<CapabilityStepResult>>,
): CapabilityImplementation {
  return { actionKey: KEY as never, version: 1, steps: steps as never }
}

const submit = () => ({
  clientId: CLIENT_A,
  actionKey: KEY,
  purpose: 'growth' as const,
  goalId: GOAL_A,
  triggeredBy: 'agent' as const,
  input: { n: 'one' },
})

const policyWithCap = (cap: number) => ({
  action_key: KEY,
  mode: 'auto_approve',
  spend_cap_per_run_usd: cap,
})

const stepCost = (f: { tables: Record<string, Array<Record<string, unknown>>> }, key: string) =>
  Number(f.tables.action_run_steps.find((s) => s.step_key === key)!.cost_actual_usd)

/** a 真花 2（刚好把 cap 花完）；b 的成本由参数决定。 */
function edgeFixture(args: {
  cap: number
  bCeiling: number
  bCost: number
  aCost?: number
  aCeiling?: number
  /** 整个动作的估算。必须 <= cap，否则授权阶段就 deny 了，测不到执行期那道闸。 */
  estimate?: number
}) {
  const bCalls = vi.fn()
  const f = makeFixture({
    registry: makeRegistry([
      definition({
        costModel: {
          kind: 'fixed',
          estimate: () => args.estimate ?? 0.01,
          stepCeilingUsd: { a: args.aCeiling ?? 2, b: args.bCeiling },
        },
      }),
    ]),
    capabilities: () => ({
      [KEY]: capabilityOf({
        a: async () => ({ output: { a: 1 }, costActualUsd: args.aCost ?? 2 }),
        b: async () => {
          bCalls()
          return { output: { done: true }, costActualUsd: args.bCost }
        },
      }),
    }),
    options: { policy: policyWithCap(args.cap) },
  })
  return { f, bCalls }
}

describe('T2 · 等号边界：已花 == 上限', () => {
  it('🔴 已花 $2 / 上限 $2 / 下一步要花钱 → handler 一次都不调', async () => {
    const { f, bCalls } = edgeFixture({ cap: 2, bCeiling: 1, bCost: 1 })

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('dead_letter')
    expect(out.execution?.failure?.code).toBe('COST_CAP_EXCEEDED')
    // 🔴 关键：供应商没被调用，钱没多花一分
    expect(bCalls).not.toHaveBeenCalled()
    expect(stepCost(f, 'a')).toBe(2)
    expect(stepCost(f, 'b')).toBe(0)
    expect(out.execution?.failure?.humanReason).toContain('这一步不开跑')
  })

  it('✅ 已花 $2 / 上限 $2 / 下一步声明零成本 → 照常跑完', async () => {
    const { f, bCalls } = edgeFixture({ cap: 2, bCeiling: 0, bCost: 0 })

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('succeeded')
    expect(bCalls).toHaveBeenCalledTimes(1)
    expect(stepCost(f, 'a')).toBe(2)
    expect(stepCost(f, 'b')).toBe(0)
  })

  it('✅ 上限 0 + 零成本步骤 → 放行（`spent >= cap` 会把这类全部拦死）', async () => {
    const { f, bCalls } = edgeFixture({
      cap: 0, bCeiling: 0, bCost: 0, aCost: 0, aCeiling: 0, estimate: 0,
    })

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('succeeded')
    expect(bCalls).toHaveBeenCalledTimes(1)
  })

  it('🔴 上限 0 + 下一步要花钱 → 第一步就拦住', async () => {
    const bCalls = vi.fn()
    const f = makeFixture({
      registry: makeRegistry([
        definition({
          steps: ['b'],
          costModel: { kind: 'fixed', estimate: () => 1, stepCeilingUsd: { b: 1 } },
        }),
      ]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          b: async () => {
            bCalls()
            return { output: { done: true }, costActualUsd: 1 }
          },
        }),
      }),
      options: { policy: policyWithCap(0) },
    })

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('denied') // 授权阶段的估算闸先拦（估 1 > 上限 0）
    expect(bCalls).not.toHaveBeenCalled()
  })

  it('✅ 上限 0 + 当前真正上线的那个能力 → 一路通过（回归护栏）', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: { action_key: KEY, mode: 'auto_approve', spend_cap_per_run_usd: 0 } },
    })

    const out = await runAction(f.kernel, {
      clientId: CLIENT_A,
      actionKey: KEY,
      purpose: 'growth',
      goalId: GOAL_A,
      triggeredBy: 'schedule',
      input: { blog_post_id: POST_A, content_hash: HASH },
    })

    expect(out.kind).toBe('succeeded')
    expect(f.tables.production_packages).toHaveLength(1)
  })

  it('🔴 估得进、实际超 → handler 照跑，但实际花费落库后停手', async () => {
    // 声明上界 1（进得去），实际却花了 3
    const { f, bCalls } = edgeFixture({ cap: 4, bCeiling: 1, bCost: 3 })

    const out = await runAction(f.kernel, submit())

    expect(bCalls).toHaveBeenCalledTimes(1) // 预检是估算，不是账本
    expect(out.kind).toBe('dead_letter')
    expect(out.execution?.failure?.code).toBe('COST_CAP_EXCEEDED')
    // 真实花费必须落库（账本认的是 actual，不是 estimate）
    expect(stepCost(f, 'b')).toBe(3)
    expect(out.execution?.failure?.humanReason).not.toContain('这一步不开跑')
  })

  it('🔴 死信重跑撞在等号边界上 → 一分钱都不许再花', async () => {
    const { f, bCalls } = edgeFixture({ cap: 2, bCeiling: 1, bCost: 1 })

    const first = await runAction(f.kernel, submit())
    expect(first.kind).toBe('dead_letter')
    expect(bCalls).not.toHaveBeenCalled()

    const again = await resumeDeadLetterRun(f.kernel, first.run.id, 'ray@magiclab')

    expect(again.kind).toBe('dead_letter')
    expect(again.execution?.failure?.code).toBe('COST_CAP_EXCEEDED')
    expect(bCalls).not.toHaveBeenCalled()
    expect(stepCost(f, 'a')).toBe(2) // 历史花费一分没变
  })

  it('没声明上界、整个动作也不是零成本 → 只在预算见底时 fail closed', async () => {
    /** a 花掉 0.5；b 没声明上界（= 成本未知）。 */
    const make = (cap: number) => {
      const bCalls = vi.fn()
      const f = makeFixture({
        registry: makeRegistry([
          // 没有 stepCeilingUsd，且 estimate 是正数 → 每一步的成本都算「未知」
          definition({ costModel: { kind: 'fixed', estimate: () => 0.5 } }),
        ]),
        capabilities: () => ({
          [KEY]: capabilityOf({
            a: async () => ({ output: { a: 1 }, costActualUsd: 0.5 }),
            b: async () => {
              bCalls()
              return { output: { done: true }, costActualUsd: 0 }
            },
          }),
        }),
        options: { policy: policyWithCap(cap) },
      })
      return { f, bCalls }
    }

    // 还有余额（1 - 0.5 = 0.5）→ 不拦。拦了等于把所有没声明成本的动作全废掉。
    const loose = make(1)
    expect((await runAction(loose.f.kernel, submit())).kind).toBe('succeeded')
    expect(loose.bCalls).toHaveBeenCalledTimes(1)

    // 预算刚好见底（0.5 - 0.5 = 0）+ 成本未知 → fail closed
    const tight = make(0.5)
    const out = await runAction(tight.f.kernel, submit())
    expect(out.kind).toBe('dead_letter')
    expect(out.execution?.failure?.code).toBe('COST_CAP_EXCEEDED')
    expect(tight.bCalls).not.toHaveBeenCalled()
    expect(out.execution?.failure?.humanReason).toContain('没有声明成本上界')
  })
})

describe('T3 · 花费必须是真实金额（应用层）', () => {
  function costFixture(reported: number) {
    return makeFixture({
      registry: makeRegistry([definition({ steps: ['a'] })]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => ({ output: { done: true }, costActualUsd: reported }),
        }),
      }),
      options: { policy: policyWithCap(10) },
    })
  }

  it('✅ 0 和正有限数照常入账', async () => {
    expect((await runAction(costFixture(0).kernel, submit())).kind).toBe('succeeded')
    const f = costFixture(1.25)
    expect((await runAction(f.kernel, submit())).kind).toBe('succeeded')
    expect(stepCost(f, 'a')).toBe(1.25)
  })

  for (const [label, value] of [
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['负数', -1],
  ] as Array<[string, number]>) {
    it(`🔴 ${label} → 停手，而且这个数字不进账本`, async () => {
      const f = costFixture(value)

      const out = await runAction(f.kernel, submit())

      expect(out.kind).toBe('dead_letter')
      expect(out.execution?.failure?.code).toBe('INVALID_COST')
      // 🔴 账本没被污染：还是初始的 0，不是 NaN / -1
      expect(stepCost(f, 'a')).toBe(0)
      // 产物照旧落库（东西可能真写出去了，lineage 得看得见）
      expect(f.tables.action_run_steps.find((s) => s.step_key === 'a')!.output).toEqual({ done: true })
    })
  }

  it('🔴 负数尤其危险：不许把已花金额减回来', async () => {
    const f = makeFixture({
      registry: makeRegistry([definition()]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => ({ output: { a: 1 }, costActualUsd: 1.5 }),
          b: async () => ({ output: { done: true }, costActualUsd: -1.5 }),
        }),
      }),
      options: { policy: policyWithCap(10) },
    })

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('dead_letter')
    expect(out.execution?.failure?.code).toBe('INVALID_COST')
    expect(stepCost(f, 'a')).toBe(1.5) // 历史花费一分没少
    expect(stepCost(f, 'b')).toBe(0)
  })
})

describe('T3 · 花费必须是真实金额（数据库层）', () => {
  function bareFixture() {
    return makeFixture({
      registry: makeRegistry([definition({ steps: ['a'] })]),
      capabilities: () => ({
        [KEY]: capabilityOf({ a: async () => ({ output: { done: true }, costActualUsd: 0 }) }),
      }),
      options: { policy: policyWithCap(10) },
    })
  }

  it('🔴 绕开应用直接 INSERT 非法金额 → 数据库拒绝', async () => {
    const f = bareFixture()
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const { error } = await f.supabase.from('action_run_steps').insert({
        run_id: 'run-x',
        client_id: CLIENT_A,
        step_key: `k-${String(bad)}`,
        step_index: 0,
        cost_actual_usd: bad,
      })
      expect(error?.message, `${String(bad)} 该被拒绝`).toContain('cost_actual_usd_is_a_real_amount')
    }
    expect(f.tables.action_run_steps).toHaveLength(0)
  })

  it('🔴 绕开应用直接 UPDATE 成非法金额 → 数据库拒绝，原值不动', async () => {
    const f = bareFixture()
    const out = await runAction(f.kernel, submit())
    expect(out.kind).toBe('succeeded')
    const stepId = f.tables.action_run_steps[0].id as string

    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { error } = await f.supabase
        .from('action_run_steps')
        .update({ cost_actual_usd: bad })
        .eq('id', stepId)
      expect(error?.message, `${String(bad)} 该被拒绝`).toContain('cost_actual_usd_is_a_real_amount')
    }
    expect(stepCost(f, 'a')).toBe(0)
  })

  it('✅ 合法金额照常写得进去（不是一刀切禁止写）', async () => {
    const f = bareFixture()
    await runAction(f.kernel, submit())
    const stepId = f.tables.action_run_steps[0].id as string

    const { error } = await f.supabase
      .from('action_run_steps')
      .update({ cost_actual_usd: 2.5 })
      .eq('id', stepId)

    expect(error).toBeNull()
    expect(stepCost(f, 'a')).toBe(2.5)
  })
})
