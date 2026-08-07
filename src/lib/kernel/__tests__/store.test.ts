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
import { beginAuthorizedRun, getActivePolicy, insertDecision, listSteps } from '../store'
import { createFakeSupabase, type Row } from './fake-supabase'
import { CLIENT_A } from './fixtures'

const RUN_ID = 'run-1'

function seed(overrides: { policy?: Row | null; run?: Partial<Row> } = {}) {
  const tables = {
    action_runs: [
      {
        id: RUN_ID,
        client_id: CLIENT_A,
        action_key: 'seo.build_publish_package',
        action_version: 1,
        idempotency_key: 'k',
        status: 'authorized',
        authorization_decision_id: null,
        started_at: null,
        last_error: null,
        ...(overrides.run ?? {}),
      } as Row,
    ],
    authorization_decisions: [] as Row[],
    action_run_steps: [] as Row[],
    client_automation_policies:
      overrides.policy === null
        ? []
        : [
            {
              id: 'policy-1',
              client_id: CLIENT_A,
              action_key: 'seo.build_publish_package',
              mode: 'auto_approve',
              policy_version: 1,
              spend_cap_per_run_usd: 0,
              spend_cap_per_period_usd: null,
              spend_cap_period: null,
              decision_ttl_seconds: 900,
              effective_from: '2020-01-01T00:00:00.000Z',
              effective_to: null,
              updated_by: 'test',
              ...(overrides.policy ?? {}),
            } as Row,
          ],
  }
  return { tables, sb: createFakeSupabase(tables) }
}

async function seedDecision(
  sb: ReturnType<typeof createFakeSupabase>,
  tables: { action_runs: Row[] },
  over: Partial<Row> = {},
) {
  const d = await insertDecision(sb, {
    action_run_id: RUN_ID,
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
    ...(over as Record<string, never>),
  })
  tables.action_runs[0].authorization_decision_id = d.id
  return d
}

describe('原子领取执行权（P1-2）', () => {
  it('第一次领到，第二次拿到 already_consumed —— 而不是抛数据库错误', async () => {
    const { sb, tables } = seed()
    const decision = await seedDecision(sb, tables)

    const first = await beginAuthorizedRun(sb, RUN_ID, decision.id, 'worker-1')
    expect(first).toEqual({ ok: true, reason: 'ok' })
    expect(tables.action_runs[0].status).toBe('running')
    expect(tables.authorization_decisions[0].consumed_by).toBe('worker-1')

    const second = await beginAuthorizedRun(sb, RUN_ID, decision.id, 'worker-2')
    expect(second.ok).toBe(false)
    // run 已经不在 authorized 了 —— 这才是「执行权只有一个」的真正判据
    expect(second.reason).toMatch(/run_not_authorized/)
  })

  it('🔴 两个 worker 同时领取 → 只有一个赢', async () => {
    const { sb, tables } = seed()
    const decision = await seedDecision(sb, tables)

    const results = await Promise.all([
      beginAuthorizedRun(sb, RUN_ID, decision.id, 'worker-1'),
      beginAuthorizedRun(sb, RUN_ID, decision.id, 'worker-2'),
    ])

    expect(results.filter((r) => r.ok)).toHaveLength(1)
  })

  it('🔴 同一个 run 的第二份 allow 决策领不到执行权（兑换的是执行权，不是决策）', async () => {
    const { sb, tables } = seed()
    const first = await seedDecision(sb, tables)
    // 又签了一份（模拟两个调用方各签一条）。run 现在指着第二份。
    const second = await seedDecision(sb, tables)
    expect(second.id).not.toBe(first.id)

    // 旧那份哪怕 verdict='allow' 且没被消费过，也领不到
    const stale = await beginAuthorizedRun(sb, RUN_ID, first.id, 'worker-1')
    expect(stale).toEqual({ ok: false, reason: 'decision_not_current' })
    expect(tables.action_runs[0].status).toBe('authorized')

    const current = await beginAuthorizedRun(sb, RUN_ID, second.id, 'worker-2')
    expect(current.ok).toBe(true)
  })

  it('🔴 政策被删掉 → 领不到（不是「没版本号所以随便过」）', async () => {
    const { sb, tables } = seed()
    const decision = await seedDecision(sb, tables)
    tables.client_automation_policies.length = 0

    const r = await beginAuthorizedRun(sb, RUN_ID, decision.id, 'w')
    expect(r).toEqual({ ok: false, reason: 'no_active_policy' })
    expect(tables.action_runs[0].status).toBe('authorized')
  })

  it('政策版本变了 → 领不到', async () => {
    const { sb, tables } = seed()
    const decision = await seedDecision(sb, tables)
    tables.client_automation_policies[0].policy_version = 2

    const r = await beginAuthorizedRun(sb, RUN_ID, decision.id, 'w')
    expect(r).toEqual({ ok: false, reason: 'stale_policy_version' })
  })

  it('跨客户 / 版本不符 / 幂等键不符 都领不到', async () => {
    for (const [over, reason] of [
      [{ client_id: 'client-other' }, 'cross_client'],
      [{ action_version: 2 }, 'action_version_mismatch'],
      [{ idempotency_key: 'other' }, 'idempotency_mismatch'],
    ] as Array<[Partial<Row>, string]>) {
      const { sb, tables } = seed()
      const decision = await seedDecision(sb, tables, over)
      const r = await beginAuthorizedRun(sb, RUN_ID, decision.id, 'w')
      expect(r).toEqual({ ok: false, reason })
    }
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
    const decision = await seedDecision(sb, tables)

    const bad = await sb
      .from('authorization_decisions')
      .update({ verdict: 'allow', reason: '偷偷改成放行' })
      .eq('id', decision.id)
      .select('id')

    expect(bad.error?.message).toMatch(/append-only/)
    expect(tables.authorization_decisions[0].reason).toBe('测试')
  })
})
