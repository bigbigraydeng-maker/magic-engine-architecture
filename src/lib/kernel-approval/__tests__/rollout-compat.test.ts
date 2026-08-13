/**
 * K-WP01A 守卫 · **RPC 上线兼容 + fail closed**（Build Control Room blocker ①）
 *
 * 要守住的是三句话：
 *   ① 数据库和代码必须能**各自独立上线** —— 历史五参入口永远可调用，
 *      新行为挂在新名字 `kernel_record_fenced_deny_v2` 上。
 *   ② 自动授权路径（没有「审批人看到的那份」这个概念）走五参入口，
 *      **不许**把 `p_expected_decision_id` 递给它 —— 真库那个函数没这个参数。
 *   ③ 人工审批的拒绝路径**只能**走 v2。v2 还没部署就**抛错**，
 *      绝不退回没有 fence 的五参调用。
 *
 * 🔴 第 ③ 条是这一批里唯一真正带安全后果的：退回去的话，`pending_approval`
 *    期间这条 run 已经被重新排成**另一份**待审批请求时，一次迟到的「批不了」
 *    会把那份**新的、还没人看过的**请求盖成 denied，而正在看它的人什么都不知道。
 *    所以这里不验「有没有抛错」就完了 —— 必须验**五参入口一次都没被调用过**。
 */

import { describe, it, expect } from 'vitest'
import { recordFencedDeny } from '@/lib/kernel/store'
import type { SupabaseClient } from '@supabase/supabase-js'

const LEGACY = 'kernel_record_fenced_deny'
const V2 = 'kernel_record_fenced_deny_v2'

type Call = { name: string; args: Record<string, unknown> }

/** 只记账、不建模业务的 sb —— 这里要证的是「打了哪个入口、带了哪些参数」。 */
function spyClient(
  reply: (name: string) => { data: unknown; error: { code?: string; message?: string } | null },
): { sb: SupabaseClient; calls: Call[] } {
  const calls: Call[] = []
  const sb = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args })
      return reply(name)
    },
  } as unknown as SupabaseClient
  return { sb, calls }
}

const OK = { data: [{ ok: true, reason: 'denied', decision_id: 'd1' }], error: null }
const MISSING_V2 = {
  data: null,
  error: {
    code: 'PGRST202',
    message: `Could not find the function public.${V2}(...) in the schema cache`,
  },
}

const baseArgs = {
  runId: '11111111-1111-4111-8111-111111111111',
  expectedGeneration: 3,
  expectedStatus: 'pending_approval' as const,
  reason: '政策漂移',
  decision: { client_id: 'c1', deny_code: 'policy_drift' },
}

describe('🔴 RPC 上线兼容：两个名字，各自独立部署', () => {
  it('自动授权路径（没有指针）打的是历史五参入口', async () => {
    const { sb, calls } = spyClient(() => OK)
    await recordFencedDeny(sb, { ...baseArgs, expectedDecisionId: null })

    expect(calls.map((c) => c.name)).toEqual([LEGACY])
  })

  it('🔴 五参入口不许收到 p_expected_decision_id —— 真库那个函数没这个参数', async () => {
    const { sb, calls } = spyClient(() => OK)
    await recordFencedDeny(sb, { ...baseArgs, expectedDecisionId: null })

    // 多带一个参数，PostgREST 按参数名找函数会直接找不到（PGRST202）。
    // 「反正有默认值」在这里不成立：五参函数根本没有这个形参。
    expect(Object.keys(calls[0].args)).not.toContain('p_expected_decision_id')
    expect(Object.keys(calls[0].args).sort()).toEqual([
      'p_decision',
      'p_expected_generation',
      'p_expected_status',
      'p_reason',
      'p_run_id',
    ])
  })

  it('人工审批路径（带指针）打的是 v2，并把指针原样递下去', async () => {
    const { sb, calls } = spyClient(() => OK)
    const pointer = '22222222-2222-4222-8222-222222222222'
    await recordFencedDeny(sb, { ...baseArgs, expectedDecisionId: pointer })

    expect(calls.map((c) => c.name)).toEqual([V2])
    expect(calls[0].args.p_expected_decision_id).toBe(pointer)
  })
})

describe('🔴 v2 没部署 = fail closed，绝不回退', () => {
  it('抛错，而且错误里说清了是「没 apply migration」', async () => {
    const { sb } = spyClient(() => MISSING_V2)
    await expect(
      recordFencedDeny(sb, {
        ...baseArgs,
        expectedDecisionId: '22222222-2222-4222-8222-222222222222',
      }),
    ).rejects.toThrow(/kernel_record_fenced_deny_v2 在这个数据库里还不存在/)
  })

  it('🔴 **五参入口一次都没被调用过** —— 这才是「不回退」的证据', async () => {
    const { sb, calls } = spyClient(() => MISSING_V2)
    await recordFencedDeny(sb, {
      ...baseArgs,
      expectedDecisionId: '22222222-2222-4222-8222-222222222222',
    }).catch(() => undefined)

    // 只验「抛了错」是不够的：一个先试 v2、失败再打五参、最后才抛错的实现
    // 同样会抛错，但那次没有 fence 的写入**已经落地了**。
    expect(calls.map((c) => c.name)).toEqual([V2])
    expect(calls.some((c) => c.name === LEGACY)).toBe(false)
  })

  it('🔴 不许把别的故障也说成「没 apply」—— 那会让运维照着去 apply 也修不好', async () => {
    const { sb } = spyClient(() => ({
      data: null,
      error: { code: '42501', message: 'permission denied for function' },
    }))
    await expect(
      recordFencedDeny(sb, {
        ...baseArgs,
        expectedDecisionId: '22222222-2222-4222-8222-222222222222',
      }),
    ).rejects.toThrow(/permission denied/)
  })
})
