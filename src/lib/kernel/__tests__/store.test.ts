/**
 * 数据访问层的两条硬性质，外加对**假件本身**的自检。
 *
 * 这个文件是变异验证逼出来的：第一轮变异把 `consumeDecision` 的
 * `.is('consumed_at', null)` 拆掉之后，13 个测试**全绿** ——
 * 因为重放在更早的一道闸（`assertDecisionMatches` 看 consumed_at）就被拦了，
 * 原子兑换那一句其实没有任何测试盯着。它防的是**并发**：
 * 两个 worker 同时读到「还没被兑换」，必须只有一个能兑换成功。
 *
 * 同一轮还发现：假件里「没建模的表就抛错」那道保险自己没有测试。
 * 那道保险是整套测试可信度的地基 —— 它一松，「查错了表名」就会
 * 长得跟「这张表是空的」一模一样，正是生产上让一个 bug 活了两个月的形状。
 */

import { describe, it, expect } from 'vitest'
import { consumeDecision, getActivePolicy, insertDecision, listSteps } from '../store'
import { createFakeSupabase } from './fake-supabase'
import { CLIENT_A } from './fixtures'

function seed() {
  const tables = {
    action_runs: [{ id: 'run-1', client_id: CLIENT_A }],
    authorization_decisions: [] as Array<Record<string, unknown>>,
    action_run_steps: [] as Array<Record<string, unknown>>,
    client_automation_policies: [] as Array<Record<string, unknown>>,
  }
  return { tables, sb: createFakeSupabase(tables) }
}

async function seedDecision(sb: ReturnType<typeof createFakeSupabase>) {
  return insertDecision(sb, {
    action_run_id: 'run-1',
    client_id: CLIENT_A,
    action_key: 'seo.build_publish_package',
    action_version: 1,
    verdict: 'allow',
    deny_code: null,
    reason: '测试',
    policy_snapshot: {},
    policy_version: 1,
    decided_by: 'policy',
    decided_by_user: null,
    cost_cap_usd: 0,
    cost_estimate_usd: 0,
    idempotency_key: 'k',
    expires_at: null,
  })
}

describe('原子兑换授权', () => {
  it('第一次兑换拿到行，第二次拿到 null —— 而不是抛数据库错误', async () => {
    const { sb } = seed()
    const decision = await seedDecision(sb)
    const now = new Date('2026-08-08T02:00:00.000Z')

    const first = await consumeDecision(sb, decision.id, 'worker-1', now)
    expect(first?.id).toBe(decision.id)
    expect(first?.consumed_by).toBe('worker-1')

    // 🔴 这一条就是在盯 `.is('consumed_at', null)`。
    //    去掉那一句，这次更新会命中已兑换的那一行、触发 append-only 触发器，
    //    于是这里拿到的是一个**抛出来的数据库错误**，而不是一个干净的 null。
    //    差别不是风格问题：null 让上层能说「这是一次重放」，
    //    抛错只能说「库出错了」，而重放和故障是两种完全不同的处置。
    const second = await consumeDecision(sb, decision.id, 'worker-2', now)
    expect(second).toBeNull()
  })

  it('两个 worker 同时兑换同一条授权 → 只有一个赢', async () => {
    const { sb } = seed()
    const decision = await seedDecision(sb)
    const now = new Date('2026-08-08T02:00:00.000Z')

    const [a, b] = await Promise.all([
      consumeDecision(sb, decision.id, 'worker-1', now),
      consumeDecision(sb, decision.id, 'worker-2', now),
    ])

    const winners = [a, b].filter(Boolean)
    expect(winners).toHaveLength(1)
  })
})

describe('读失败一律抛错，绝不 return []', () => {
  it('读政策炸了 → 抛错，不当成「这个客户没配政策」', async () => {
    const tables = { client_automation_policies: [] }
    const sb = createFakeSupabase(tables, {
      failOn: [{ table: 'client_automation_policies', op: 'select', message: 'connection reset' }],
    })
    // 「没配政策」和「读不到政策」都会导致不放行，但只有前者该说
    // 「去给这个客户设一条规则」，后者该说「库出问题了」。合并成一条
    // return null，就等于把一次数据库抖动伪装成一个业务结论。
    await expect(getActivePolicy(sb, CLIENT_A, 'x', new Date())).rejects.toThrow(/connection reset/)
  })

  it('读步骤炸了 → 抛错，不当成「这个 run 没有步骤」', async () => {
    const tables = { action_run_steps: [] }
    const sb = createFakeSupabase(tables, {
      failOn: [{ table: 'action_run_steps', op: 'select', message: 'timeout' }],
    })
    await expect(listSteps(sb, 'run-1')).rejects.toThrow(/timeout/)
  })
})

describe('假件本身的保险：没建模的表必须炸', () => {
  it('查一张测试没建模的表 → 抛错，不返回空数组', async () => {
    const sb = createFakeSupabase({ action_runs: [] })
    // 🔴 如果这里返回 []，那么「写错表名」「表还没建」「表是空的」
    //    在测试里就是同一个现象 —— 这套测试的结论也就一文不值了。
    await expect(sb.from('table_that_does_not_exist').select('*')).rejects.toThrow(/没有为表/)
  })

  it('调一个没建模的 RPC → 抛错', async () => {
    const sb = createFakeSupabase({ action_runs: [] })
    await expect(sb.rpc('some_other_rpc', {})).rejects.toThrow(/没有建模的 RPC/)
  })

  it('唯一约束是真的：同客户同幂等键插两次 → 第二次报冲突', async () => {
    const tables = { action_runs: [] as Array<Record<string, unknown>> }
    const sb = createFakeSupabase(tables)
    const row = { client_id: CLIENT_A, idempotency_key: 'same', action_key: 'x', purpose: 'growth' }

    const first = await sb.from('action_runs').insert(row).select('id')
    expect(first.error).toBeNull()

    const second = await sb.from('action_runs').insert(row).select('id')
    expect(second.error?.message).toMatch(/duplicate key/)
    expect(tables.action_runs).toHaveLength(1)
  })

  it('append-only 是真的：改授权记录的正文会被拒绝', async () => {
    const { sb, tables } = seed()
    const decision = await seedDecision(sb)

    const bad = await sb
      .from('authorization_decisions')
      .update({ verdict: 'allow', reason: '偷偷改成放行' })
      .eq('id', decision.id)
      .select('id')

    expect(bad.error?.message).toMatch(/append-only/)
    expect(tables.authorization_decisions[0].reason).toBe('测试')
  })
})
