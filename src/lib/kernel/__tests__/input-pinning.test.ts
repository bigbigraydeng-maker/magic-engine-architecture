/**
 * A · Authorized Input Pinning + TOCTOU 关闭 —— hardening v1。
 *
 * 覆盖 Issue #1106 minimum acceptance 中 A 相关的 5 条：
 *   ① authorize 时 pin 完整 canonical SHA-256 到 policy_snapshot.input_hash（lowercase, 64 hex, 不截断）
 *   ② Gateway 执行前重读 + 重算 + 严格相等
 *   ③ mutated input after authorization → INPUT_TAMPERED_SINCE_AUTHORIZE fail-closed，capability 一次都不调
 *   ④ 旧 decision 缺 input_hash → 一律 fail-closed
 *   ⑤ ctx.runInput 是深冻结的 —— 顶层 / 数组 / 嵌套对象都改不动
 *   ⑥ human approval finalize 前的 hash 复核（挂起期间 input 被换）
 *   ⑦ canonical stringify 的稳定性（键顺序不影响 hash；数组顺序影响 hash）
 */

import { describe, it, expect } from 'vitest'
import { runAction, submitActionRun, approveAndRun } from '../runner'
import { authorizeRun } from '../authorize'
import { executeAuthorizedRun } from '../gateway'
import { approveRun } from '../human-approval'
import { canonicalHashOfInput, canonicalStringify, deepFreezeVerifiedInput } from '../canonical-hash'
import { ACTION_REGISTRY } from '../registry'
import { createCapabilities, computeBlogContentHash } from '@/lib/capabilities'
import type { BlogDraftRow } from '@/lib/capabilities/seo/build-publish-package'
import { CLIENT_A, GOAL_A, POST_A, BLOG_DRAFT, makeFixture, liveFence } from './fixtures'
import type { CapabilityImplementation, AuthorizedExecutionContext } from '../types'
import { KernelError } from '../errors'

const KEY = 'seo.build_publish_package'
const HASH = computeBlogContentHash(BLOG_DRAFT as unknown as BlogDraftRow)

function submitInput() {
  return {
    clientId: CLIENT_A,
    actionKey: KEY,
    purpose: 'growth' as const,
    goalId: GOAL_A,
    triggeredBy: 'schedule' as const,
    input: { blog_post_id: POST_A, content_hash: HASH },
  }
}

const AUTO_POLICY = {
  action_key: KEY,
  mode: 'auto_approve',
  spend_cap_per_run_usd: 0,
}

const APPROVAL_POLICY = {
  action_key: KEY,
  mode: 'require_approval',
  spend_cap_per_run_usd: 0,
}

// ── ①-② input_hash pin 与 execution-time 验证 ─────────────────────────────────

describe('A1 · authorize 时 pin 完整 canonical SHA-256', () => {
  it('policy_snapshot.input_hash 精确匹配 lowercase 64 hex', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: AUTO_POLICY },
    })
    await runAction(f.kernel, submitInput())
    const allow = f.tables.authorization_decisions.find((d) => d.verdict === 'allow')
    const inputHash = (allow?.policy_snapshot as { input_hash?: unknown })?.input_hash
    expect(inputHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('pinned hash 跟 canonicalHashOfInput(run.input) 相等', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: AUTO_POLICY },
    })
    const { run } = await submitActionRun(f.kernel, submitInput())
    await runAction(f.kernel, submitInput())
    const allow = f.tables.authorization_decisions.find((d) => d.verdict === 'allow')
    expect((allow?.policy_snapshot as { input_hash?: unknown }).input_hash).toBe(
      canonicalHashOfInput(run.input),
    )
  })

  it('挂起等审批时也 pin（require_approval 决策也带 input_hash）', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: APPROVAL_POLICY },
    })
    await runAction(f.kernel, submitInput())
    const pending = f.tables.authorization_decisions.find((d) => d.verdict === 'require_approval')
    expect((pending?.policy_snapshot as { input_hash?: unknown }).input_hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('A2 · Gateway 执行前 hash 复核（TOCTOU 关闭）', () => {
  it('input 未动 → 放行，capability 正常跑', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: AUTO_POLICY, masterBriefs: [{ id: 'brief-1', client_id: CLIENT_A }] },
    })
    const outcome = await runAction(f.kernel, submitInput())
    expect(outcome.kind).toBe('succeeded')
  })

  it('🔴 授权签发后 UPDATE action_runs.input → INPUT_TAMPERED_SINCE_AUTHORIZE，capability 一次都不调', async () => {
    const calls: string[] = []
    const spyCapabilities = (): Readonly<Record<string, CapabilityImplementation>> => ({
      [KEY]: {
        actionKey: KEY,
        version: 1,
        steps: {
          build: async () => {
            calls.push('build')
            return { output: {}, costActualUsd: 0 }
          },
          persist: async () => {
            calls.push('persist')
            return { output: {}, costActualUsd: 0 }
          },
          verify: async () => {
            calls.push('verify')
            return {
              output: {},
              costActualUsd: 0,
              verification: { method: 'package_integrity', passed: true, checks: [] },
            }
          },
        },
      } as unknown as CapabilityImplementation,
    })
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: spyCapabilities,
      options: { policy: AUTO_POLICY },
    })

    // 拿到 authorize 后的 authorized run + ctx
    const { run } = await submitActionRun(f.kernel, submitInput())
    const auth = await authorizeRun(f.kernel, run)
    expect(auth.verdict).toBe('allow')
    expect(auth.ctx).not.toBeNull()

    // 关键：授权已签发，现在偷偷把 action_runs.input 换成另一份
    const runRow = f.tables.action_runs.find((r) => r.id === run.id) as Record<string, unknown>
    runRow.input = { blog_post_id: 'ANOTHER-POST', content_hash: 'DIFFERENT' }

    await expect(
      executeAuthorizedRun(f.kernel, auth.ctx!, liveFence(f, run.id)),
    ).rejects.toThrow(/自从授权签发以来被改过|INPUT_TAMPERED/)
    expect(calls, 'capability handler 一次都不该被调').toEqual([])
  })

  it('🔴 旧 decision 缺 input_hash → 一律 fail-closed（前向兼容不能开天窗）', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: AUTO_POLICY },
    })
    const { run } = await submitActionRun(f.kernel, submitInput())
    const auth = await authorizeRun(f.kernel, run)
    // 模拟旧 decision：把 input_hash 从 policy_snapshot 里挖掉
    const decisionRow = f.tables.authorization_decisions.find((d) => d.verdict === 'allow') as Record<
      string,
      unknown
    >
    const snap = decisionRow.policy_snapshot as Record<string, unknown>
    delete snap.input_hash

    await expect(
      executeAuthorizedRun(f.kernel, auth.ctx!, liveFence(f, run.id)),
    ).rejects.toThrow(/没有 pin 输入指纹|INPUT_TAMPERED/)
  })
})

// ── ③ deep-freeze runInput ────────────────────────────────────────────────────

describe('A3 · ctx.runInput 深冻结（浅冻结救不了 TOCTOU）', () => {
  it('顶层字段不许改（strict mode TypeError）', async () => {
    let capturedInput: Record<string, unknown> | null = null
    const capturingCap = (): Readonly<Record<string, CapabilityImplementation>> => ({
      [KEY]: {
        actionKey: KEY,
        version: 1,
        steps: {
          build: async ({ runInput }: { runInput: Readonly<Record<string, unknown>> }) => {
            capturedInput = runInput as Record<string, unknown>
            return { output: { blog_post_id: POST_A, content_hash: HASH }, costActualUsd: 0 }
          },
          persist: async () => ({ output: { package_id: 'p1', content_hash: HASH }, costActualUsd: 0 }),
          verify: async () => ({
            output: { package_id: 'p1' },
            costActualUsd: 0,
            verification: { method: 'package_integrity', passed: true, checks: [] },
          }),
        },
      } as unknown as CapabilityImplementation,
    })
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: capturingCap,
      options: { policy: AUTO_POLICY },
    })
    await runAction(f.kernel, submitInput())

    expect(capturedInput).not.toBeNull()
    expect(Object.isFrozen(capturedInput)).toBe(true)
    expect(() => {
      ;(capturedInput as Record<string, unknown>).blog_post_id = 'X'
    }).toThrow(TypeError)
  })

  it('嵌套对象 / 数组也冻结（浅冻结会漏 nested mutation）', () => {
    const input = {
      intents: [{ field: 'meta_title', value: 'X' }],
      nested: { a: { b: 1 } },
    }
    const frozen = deepFreezeVerifiedInput(input)
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen.intents)).toBe(true)
    expect(Object.isFrozen(frozen.intents[0])).toBe(true)
    expect(Object.isFrozen(frozen.nested)).toBe(true)
    expect(Object.isFrozen(frozen.nested.a)).toBe(true)
    expect(() => {
      ;(frozen.intents[0] as { field: string }).field = 'meta_description'
    }).toThrow(TypeError)
    expect(() => {
      ;(frozen.intents as unknown as Array<unknown>).push({ x: 1 })
    }).toThrow(TypeError)
    expect(() => {
      ;(frozen.nested.a as { b: number }).b = 999
    }).toThrow(TypeError)
  })

  it('deep clone：mutation 原对象后 frozen 不变（不共享引用）', () => {
    const input = { arr: [1, 2, 3], obj: { k: 'v' } }
    const frozen = deepFreezeVerifiedInput(input)
    // 原对象没冻结，可以 mutate
    input.arr.push(4)
    input.obj.k = 'changed'
    expect(frozen.arr).toEqual([1, 2, 3])
    expect(frozen.obj.k).toBe('v')
  })
})

// ── ⑥ human approval hash re-verify ───────────────────────────────────────────

describe('A4 · Human Approval finalize 前的 hash 复核', () => {
  it('🔴 人打开审批页 → 期间 input 被替换 → finalize 时抛 INPUT_TAMPERED_SINCE_AUTHORIZE，不签 allow', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: APPROVAL_POLICY },
    })
    const { run } = await submitActionRun(f.kernel, submitInput())
    // 提交 → 授权 → pending_approval
    await authorizeRun(f.kernel, run)
    // 挂起期间 input 被人换成另一份
    const runRow = f.tables.action_runs.find((r) => r.id === run.id) as Record<string, unknown>
    runRow.input = { blog_post_id: 'DIFFERENT', content_hash: 'X' }

    await expect(approveRun(f.kernel, run.id, 'evil@x.com')).rejects.toThrow(
      /挂起审批以来被改过|INPUT_TAMPERED/,
    )

    // 断言：没有签出 allow decision
    const allowExists = f.tables.authorization_decisions.some((d) => d.verdict === 'allow')
    expect(allowExists).toBe(false)
  })

  it('input 未动 → 正常允许', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: createCapabilities,
      options: { policy: APPROVAL_POLICY },
    })
    await runAction(f.kernel, submitInput())
    const result = await approveAndRun(f.kernel, f.tables.action_runs[0].id as string, 'ok@x.com')
    expect(['succeeded', 'dead_letter']).toContain(result.kind) // 执行本身可能过或不过，但不该在批准这一步就 fail
    const allowExists = f.tables.authorization_decisions.some((d) => d.verdict === 'allow')
    expect(allowExists).toBe(true)
  })
})

// ── ⑦ canonical stringify 稳定性 ──────────────────────────────────────────────

describe('A5 · canonical stringify 稳定性', () => {
  it('键顺序不影响 hash', () => {
    expect(canonicalHashOfInput({ a: 1, b: 2, c: 3 })).toBe(canonicalHashOfInput({ c: 3, b: 2, a: 1 }))
  })

  it('嵌套对象键顺序也不影响', () => {
    expect(canonicalHashOfInput({ outer: { a: 1, b: 2 } })).toBe(
      canonicalHashOfInput({ outer: { b: 2, a: 1 } }),
    )
  })

  it('🔴 数组顺序**影响** hash（数组有语义，intents[0] ≠ intents[1]）', () => {
    expect(canonicalHashOfInput({ intents: [1, 2] })).not.toBe(canonicalHashOfInput({ intents: [2, 1] }))
  })

  it('加字段 / 改值 / 删字段 → hash 全变', () => {
    const base = { a: 1, b: 2 }
    expect(canonicalHashOfInput({ ...base, c: 3 })).not.toBe(canonicalHashOfInput(base))
    expect(canonicalHashOfInput({ ...base, a: 999 })).not.toBe(canonicalHashOfInput(base))
    expect(canonicalHashOfInput({ a: 1 })).not.toBe(canonicalHashOfInput(base))
  })

  it('undefined 值的键被跳过（跟 JSON.stringify 一致）', () => {
    expect(canonicalHashOfInput({ a: 1, b: undefined })).toBe(canonicalHashOfInput({ a: 1 }))
  })

  it('canonicalStringify 输出无多余空白', () => {
    expect(canonicalStringify({ a: 1, b: [2, 3] })).toBe('{"a":1,"b":[2,3]}')
  })
})

// ── retry snapshot 复用 ───────────────────────────────────────────────────────

describe('A6 · 单次 execution 内的 step retry 复用同一份 runInput snapshot', () => {
  it('retry 时 handler 收到的是同一份深冻结 snapshot（不重进 Gateway，不重 hash-check）', async () => {
    const seenInputs: Array<Record<string, unknown>> = []
    let firstAttempt = true
    const retryCap = (): Readonly<Record<string, CapabilityImplementation>> => ({
      [KEY]: {
        actionKey: KEY,
        version: 1,
        steps: {
          build: async ({ runInput }: { runInput: Readonly<Record<string, unknown>> }) => {
            seenInputs.push(runInput as Record<string, unknown>)
            if (firstAttempt) {
              firstAttempt = false
              const { RetryableCapabilityError } = await import('../errors')
              throw new RetryableCapabilityError('retry me once')
            }
            return { output: { blog_post_id: POST_A, content_hash: HASH }, costActualUsd: 0 }
          },
          persist: async () => ({ output: { package_id: 'p1', content_hash: HASH }, costActualUsd: 0 }),
          verify: async () => ({
            output: { package_id: 'p1' },
            costActualUsd: 0,
            verification: { method: 'package_integrity', passed: true, checks: [] },
          }),
        },
      } as unknown as CapabilityImplementation,
    })
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: retryCap,
      options: { policy: AUTO_POLICY },
    })
    await runAction(f.kernel, submitInput())
    expect(seenInputs.length).toBeGreaterThanOrEqual(2)
    // 两次 attempt 拿到的应是**同一份**引用（同一次 execution 内复用 snapshot）
    expect(seenInputs[0]).toBe(seenInputs[1])
    expect(Object.isFrozen(seenInputs[0])).toBe(true)
  })
})
