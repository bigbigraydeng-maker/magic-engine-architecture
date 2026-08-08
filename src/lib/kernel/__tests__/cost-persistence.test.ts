/**
 * S3（P2-2）—— **已经发生的事实必须先落库，再决定这次算不算成功。**
 *
 * handler 返回的那一刻，钱已经花了、验证结论也已经有了。
 * 如果先判定「超预算 / 没验过」再抛错，这些事实就永远进不了库：
 *   · 数据库以为钱没花 → 死信重跑时 spent 从低估的数字起算 →
 *     再调一次 handler → **真正突破预算上限**；
 *   · 失败的验证结论丢失 → lineage 里查不到「它到底是怎么没做成的」。
 *
 * 另一半：`cost_actual_usd` 是**累计**语义。重试 / 死信重跑都不许让
 * 历史已花的钱变小 —— 变小 = 同一笔预算可以被反复消费。
 */

import { describe, it, expect, vi } from 'vitest'
import type { ActionDefinition, CapabilityImplementation, CapabilityStepResult } from '../types'
import { runAction, resumeDeadLetterRun } from '../runner'
import { loadActionLineage } from '../lineage'
import { KernelError, RetryableCapabilityError } from '../errors'
import { makeFixture, makeRegistry, CLIENT_A, GOAL_A } from './fixtures'

const KEY = 'seo.build_publish_package'

/** 合成动作：两步、可声明验证、不许重试（把变量收到最少）。 */
function definition(over: Partial<ActionDefinition> = {}): ActionDefinition {
  return {
    actionKey: KEY,
    version: 1,
    title: '花钱的测试动作',
    inputSchema: { type: 'object', required: ['n'], properties: { n: { type: 'string' } }, additionalProperties: false },
    outputSchema: { type: 'object', required: ['done'], properties: { done: { type: 'boolean' } }, additionalProperties: true },
    capability: 'test',
    risk: 'low',
    sideEffect: 'internal_write',
    reversible: true,
    idempotency: { keyFields: ['n'], scope: 'client' },
    costModel: { kind: 'fixed', estimate: () => 0 },
    retryPolicy: { maxAttempts: 1, backoff: 'fixed', baseMs: 1 },
    verification: null,
    requiredCapabilityTier: 'paid_client',
    steps: ['a', 'b'],
    allowedPurposes: ['growth'],
    ...over,
  } as ActionDefinition
}

function capabilityOf(
  steps: Record<string, (s: { attempt: number }) => Promise<CapabilityStepResult>>,
): CapabilityImplementation {
  return { actionKey: KEY as never, version: 1, steps: steps as never }
}

function submit() {
  return {
    clientId: CLIENT_A,
    actionKey: KEY,
    purpose: 'growth' as const,
    goalId: GOAL_A,
    triggeredBy: 'agent' as const,
    input: { n: 'one' },
  }
}

const policyWithCap = (cap: number) => ({
  action_key: KEY,
  mode: 'auto_approve',
  spend_cap_per_run_usd: cap,
})

const stepCost = (f: ReturnType<typeof makeFixture>, key: string) =>
  Number(f.tables.action_run_steps.find((s) => s.step_key === key)!.cost_actual_usd)
const totalCost = (f: ReturnType<typeof makeFixture>) =>
  f.tables.action_run_steps.reduce((sum, s) => sum + Number(s.cost_actual_usd ?? 0), 0)

describe('S3 · 超预算之前，本次已经花掉的钱先落库', () => {
  it('🔴 handler 返回 cost=1 后超上限 → 库里 cost=1，run 死信（钱不许因为失败被抹掉）', async () => {
    const f = makeFixture({
      registry: makeRegistry([definition({ steps: ['a'] })]),
      capabilities: () => ({
        [KEY]: capabilityOf({ a: async () => ({ output: { done: true }, costActualUsd: 1 }) }),
      }),
      options: { policy: policyWithCap(0.5) }, // 上限 0.5，这一步要花 1
    })

    const outcome = await runAction(f.kernel, submit())

    expect(outcome.kind).toBe('dead_letter')
    expect(outcome.execution?.failure?.code).toBe('COST_CAP_EXCEEDED')
    // 🔴 关键：钱进了库
    expect(stepCost(f, 'a')).toBe(1)
    // 而且产物也留下了（东西可能真的已经写出去了，lineage 得看得见）
    expect(f.tables.action_run_steps.find((s) => s.step_key === 'a')!.output).toEqual({ done: true })
  })

  it('🔴 handler 同时返回 cost 和没通过的验证 → 两样都持久化，lineage 读得到', async () => {
    const failed = {
      method: 'package_integrity' as const,
      passed: false,
      checks: [{ name: '指纹一致', passed: false, detail: '写进去的跟该写的对不上' }],
      failure_reason: '内容指纹对不上',
    }
    const f = makeFixture({
      registry: makeRegistry([
        definition({ steps: ['a'], verification: { method: 'package_integrity', delayMs: 0 } }),
      ]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => ({ output: { done: true }, costActualUsd: 0.25, verification: failed }),
        }),
      }),
      options: { policy: policyWithCap(10) },
    })

    const outcome = await runAction(f.kernel, submit())

    expect(outcome.kind).toBe('dead_letter')
    expect(outcome.execution?.failure?.code).toBe('VERIFICATION_FAILED')
    expect(stepCost(f, 'a')).toBe(0.25)
    // 🔴 失败的验证结论必须留在库里 —— 不然 lineage 里查不到「它是怎么没做成的」
    const persisted = f.tables.action_run_steps.find((s) => s.step_key === 'a')!.verification
    expect(persisted).toEqual(failed)

    const lineage = await loadActionLineage(f.supabase, outcome.run.id)
    expect(lineage!.verification?.passed).toBe(false)
    expect(lineage!.verification?.failure_reason).toBe('内容指纹对不上')
    expect(lineage!.humanSummary).toContain('验没过')
  })
})

describe('S3 · 死信重跑之后，预算从历史真实花费起算', () => {
  /** a 花 1.5 成功；b 第一次炸、之后每次花 1。 */
  function budgetFixture(cap: number) {
    const control = { failB: true }
    const bCalls = vi.fn()
    const f = makeFixture({
      registry: makeRegistry([definition()]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => ({ output: { a: 1 }, costActualUsd: 1.5 }),
          b: async () => {
            bCalls()
            if (control.failB) throw new KernelError('INVALID_STATE', '下游还没准备好')
            return { output: { done: true }, costActualUsd: 1 }
          },
        }),
      }),
      options: { policy: policyWithCap(cap) },
    })
    return { f, control, bCalls }
  }

  it('🔴 重跑时 spent 含历史 1.5 → 再花 1 就超上限 2，且这 1 也落了库', async () => {
    const { f, control, bCalls } = budgetFixture(2)

    const first = await runAction(f.kernel, submit())
    expect(first.kind).toBe('dead_letter')
    expect(stepCost(f, 'a')).toBe(1.5)
    expect(stepCost(f, 'b')).toBe(0) // 第一次 b 直接抛，没产生花费

    control.failB = false
    const resumed = await resumeDeadLetterRun(f.kernel, first.run.id, 'ray@magiclab')

    // a 没重跑（断点续跑），b 花了 1 → 累计 2.5 > 上限 2
    expect(resumed.kind).toBe('dead_letter')
    expect(resumed.execution?.failure?.code).toBe('COST_CAP_EXCEEDED')
    expect(stepCost(f, 'a')).toBe(1.5)
    expect(stepCost(f, 'b')).toBe(1)
    expect(totalCost(f)).toBe(2.5)
    expect(bCalls).toHaveBeenCalledTimes(2)
  })

  it('🔴 已经超上限之后再重跑：handler 一次都不许再调（钱不能被反复消费）', async () => {
    const { f, control, bCalls } = budgetFixture(2)

    const first = await runAction(f.kernel, submit())
    control.failB = false
    await resumeDeadLetterRun(f.kernel, first.run.id, 'ray@magiclab')
    const afterFirstResume = totalCost(f)
    expect(afterFirstResume).toBe(2.5) // 已经超了上限 2
    expect(bCalls).toHaveBeenCalledTimes(2)

    const second = await resumeDeadLetterRun(f.kernel, first.run.id, 'ray@magiclab')

    expect(second.kind).toBe('dead_letter')
    expect(second.execution?.failure?.code).toBe('COST_CAP_EXCEEDED')
    // 🔴 开跑前就该拦住 —— 只在事后判的话，这里会**再花一次钱**才发现超了，
    //    等于原来那条上限对重跑完全失效。
    expect(bCalls).toHaveBeenCalledTimes(2)
    expect(stepCost(f, 'b')).toBe(1)
    expect(totalCost(f)).toBe(afterFirstResume) // 只增不减，也没有多花
    expect(stepCost(f, 'a')).toBe(1.5) // a 从头到尾只跑过一次
    // 拦在开跑前和跑完之后，给人看的话不一样 —— 这条钉死是**前者**
    expect(second.execution?.failure?.humanReason).toContain('不再开跑')
  })

  it('把上限提高之后再重跑 → 开跑前那道闸放行，这一步真的跑完', async () => {
    const { f, control, bCalls } = budgetFixture(2)

    const first = await runAction(f.kernel, submit())
    control.failB = false
    await resumeDeadLetterRun(f.kernel, first.run.id, 'ray@magiclab')
    expect(totalCost(f)).toBe(2.5)

    // 人把这个客户的单次上限从 2 提到 10（改规则要升版本）
    const policy = f.tables.client_automation_policies.find((p) => p.action_key === KEY)!
    policy.spend_cap_per_run_usd = 10
    policy.policy_version = Number(policy.policy_version) + 1

    const third = await resumeDeadLetterRun(f.kernel, first.run.id, 'ray@magiclab')

    expect(third.kind).toBe('succeeded')
    expect(bCalls).toHaveBeenCalledTimes(3)
    // 这次真的又花了 1 → 累计 3.5，仍然只增不减
    expect(stepCost(f, 'b')).toBe(2)
    expect(totalCost(f)).toBe(3.5)
  })

  it('上限够大时重跑正常成功，且总花费如实累加', async () => {
    const { f, control } = budgetFixture(10)

    const first = await runAction(f.kernel, submit())
    expect(first.kind).toBe('dead_letter')

    control.failB = false
    const resumed = await resumeDeadLetterRun(f.kernel, first.run.id, 'ray@magiclab')

    expect(resumed.kind).toBe('succeeded')
    expect(totalCost(f)).toBe(2.5)
  })
})

describe('S3 · 重试之内，同一步的花费也累加', () => {
  it('前两次抛错前没产生花费 → 该步只记最后一次真花的 0.5（累计不等于乱加）', async () => {
    let calls = 0
    const f = makeFixture({
      registry: makeRegistry([definition({ steps: ['a'], retryPolicy: { maxAttempts: 3, backoff: 'fixed', baseMs: 1 } })]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => {
            calls += 1
            if (calls < 3) {
              // 先花钱、再失败 —— 钱已经花出去了
              throw new RetryableCapabilityError('上游 429')
            }
            return { output: { done: true }, costActualUsd: 0.5 }
          },
        }),
      }),
      options: { policy: policyWithCap(10) },
    })

    const outcome = await runAction(f.kernel, submit())
    expect(outcome.kind).toBe('succeeded')
    // 前两次抛错前没返回 cost，所以只有最后一次的 0.5 —— 这条确认「不多算」
    expect(stepCost(f, 'a')).toBe(0.5)
  })

  it('🔴 每次尝试都返回 cost（钱真花了才失败）→ 累计，不被最后一次覆盖', async () => {
    let calls = 0
    const f = makeFixture({
      registry: makeRegistry([
        definition({
          steps: ['a'],
          retryPolicy: { maxAttempts: 3, backoff: 'fixed', baseMs: 1 },
          verification: { method: 'package_integrity', delayMs: 0 },
        }),
      ]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => {
            calls += 1
            // 每次都真的花了 0.4；前两次验证不过（不可重试），所以其实只跑一次
            return {
              output: { done: true },
              costActualUsd: 0.4,
              verification:
                calls < 3
                  ? { method: 'package_integrity' as const, passed: false, checks: [], failure_reason: '没验过' }
                  : { method: 'package_integrity' as const, passed: true, checks: [] },
            }
          },
        }),
      }),
      options: { policy: policyWithCap(10) },
    })

    const first = await runAction(f.kernel, submit())
    // 验证不过不重试 → 一次就死信，但那 0.4 已经花了
    expect(first.kind).toBe('dead_letter')
    expect(stepCost(f, 'a')).toBe(0.4)

    // 重跑：第二次仍然验证不过，钱累加到 0.8
    const second = await resumeDeadLetterRun(f.kernel, first.run.id, 'ray@magiclab')
    expect(second.kind).toBe('dead_letter')
    expect(stepCost(f, 'a')).toBeCloseTo(0.8, 10)

    // 第三次验证通过，钱累加到 1.2 —— **从头到尾没有一次变小**
    const third = await resumeDeadLetterRun(f.kernel, first.run.id, 'ray@magiclab')
    expect(third.kind).toBe('succeeded')
    expect(stepCost(f, 'a')).toBeCloseTo(1.2, 10)
  })
})

describe('S3 · 成功路径的原有行为不变', () => {
  it('正常成功时 cost / verification / output 照旧落库', async () => {
    const ok = { method: 'package_integrity' as const, passed: true, checks: [{ name: '回读', passed: true }] }
    const f = makeFixture({
      registry: makeRegistry([
        definition({ steps: ['a'], verification: { method: 'package_integrity', delayMs: 0 } }),
      ]),
      capabilities: () => ({
        [KEY]: capabilityOf({
          a: async () => ({ output: { done: true }, costActualUsd: 0.3, verification: ok }),
        }),
      }),
      options: { policy: policyWithCap(10) },
    })

    const outcome = await runAction(f.kernel, submit())

    expect(outcome.kind).toBe('succeeded')
    const step = f.tables.action_run_steps.find((s) => s.step_key === 'a')!
    expect(step.status).toBe('succeeded')
    expect(step.cost_actual_usd).toBe(0.3)
    expect(step.verification).toEqual(ok)
    expect(step.output).toEqual({ done: true })
    expect(outcome.execution?.verification).toEqual(ok)
  })
})
