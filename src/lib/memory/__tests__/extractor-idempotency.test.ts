/**
 * 记忆抽取器的幂等回归。
 *
 * 这个文件存在的唯一理由：**归因作业每 6 小时把 flywheel_outcomes 整条删掉重建**
 * （`flywheel/attribution/job.ts` 的 `.delete().eq('action_id', id)` + `.insert()`），
 * 而 `flywheel_outcomes.id` 是 `gen_random_uuid()`。所以「同一条归因结论」的 id
 * 每 6 小时换一个。
 *
 * 抽取器早先拿 outcome.id 当去重键。接上每日 cron 之后那会变成：
 * 第 1 天写一条经验 → 归因重跑换 id → 第 2 天去重对不上 → 再写一条一模一样的 →
 * 每天 +1，永不收敛。诸葛亮读记忆只取最新 15 条，两周后那 15 条全是同一条经验的副本。
 *
 * 所以下面每个用例都在问同一个问题：**换了 outcome.id 之后还会不会写重。**
 */

import { describe, it, expect } from 'vitest'
import { runExtractorForClient } from '../extractor'

const CLIENT = 'c1111111-1111-1111-1111-111111111111'
const ACTION_A = 'a1111111-1111-1111-1111-111111111111'
const ACTION_B = 'b2222222-2222-2222-2222-222222222222'

interface Row { [k: string]: unknown }

/**
 * 够用的 Supabase 桩：只实现抽取器真正走到的链式调用。
 *
 * 刻意**不**模拟 PostgREST 的 1000 行截断 —— 那是 `fetchAll` 的职责，
 * 在这里模拟只会把测试变成在测 mock。这里测的是幂等。
 */
function makeSupabase(tables: Record<string, Row[]>) {
  const inserted: Record<string, Row[]> = {}

  const builder = (table: string) => {
    const filters: Array<(r: Row) => boolean> = []
    let selected = true

    const api: Record<string, unknown> = {
      select() { selected = true; return api },
      eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return api },
      in(col: string, vals: unknown[]) { filters.push((r) => vals.includes(r[col])); return api },
      is(col: string, val: unknown) { filters.push((r) => r[col] === val); return api },
      not(col: string, _op: string, _val: unknown) { filters.push((r) => r[col] != null); return api },
      gte() { return api },
      lte() { return api },
      order() { return api },
      limit() { return api },
      range(from: number, to: number) {
        const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
      },
      insert(row: Row) {
        const stored = { ...row, id: `gen-${Math.random()}` }
        ;(inserted[table] ??= []).push(stored)
        ;(tables[table] ??= []).push(stored)
        return {
          select: () => ({ single: () => Promise.resolve({ data: stored, error: null }) }),
        }
      },
      update() { return { eq: () => Promise.resolve({ error: null }) } },
      // 没有 .range() 的读（extractor 里的 backfill 用 .limit()）走这条
      then(resolve: (v: { data: Row[]; error: null }) => unknown) {
        const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
        return Promise.resolve(resolve({ data: selected ? rows : [], error: null }))
      },
    }
    return api
  }

  return {
    supabase: { from: (t: string) => builder(t) } as never,
    inserted,
    tables,
  }
}

/** 造一条 confirmed 归因结论。`outcomeId` 每次可以不同 —— 这正是重点。 */
function outcome(outcomeId: string, actionId: string) {
  return {
    id: outcomeId,
    client_id: CLIENT,
    action_id: actionId,
    metric_key: 'keyword_rank',
    delta: 4,
    delta_pct: 40,
    confidence: 0.9,
    verdict: 'confirmed',
    computed_at: '2026-08-01T00:00:00Z',
    window_days: 14,
  }
}

function action(actionId: string, actionType = 'blog_publish') {
  return {
    id: actionId,
    action_type: actionType,
    flywheel: 'seo',
    vendor: null,
    executed_at: '2026-07-01T00:00:00Z',
  }
}

describe('记忆抽取器 · 幂等', () => {
  it('归因重跑换掉 outcome.id 之后，同一个动作不再写第二条经验', async () => {
    const tables: Record<string, Row[]> = {
      flywheel_outcomes: [outcome('outcome-第一次归因', ACTION_A)],
      flywheel_actions: [action(ACTION_A)],
      client_proven_patterns: [],
      client_failed_experiments: [],
      client_learned_preferences: [],
      client_decision_history: [],
    }
    const { supabase, inserted } = makeSupabase(tables)

    // 第 1 天
    const first = await runExtractorForClient(supabase, CLIENT)
    expect(first.errors).toEqual([])
    expect(first.patterns_added).toBe(1)

    // 归因作业跑了：整条删掉重建，id 变了，内容没变
    tables.flywheel_outcomes = [outcome('outcome-第二次归因-全新的id', ACTION_A)]

    // 第 2 天
    const second = await runExtractorForClient(supabase, CLIENT)
    expect(second.errors).toEqual([])
    expect(second.patterns_added).toBe(0)          // ← 回归点
    expect(inserted.client_proven_patterns).toHaveLength(1)
  })

  it('经验的溯源挂 action_id，不挂 outcome_id', async () => {
    const tables: Record<string, Row[]> = {
      flywheel_outcomes: [outcome('outcome-xyz', ACTION_A)],
      flywheel_actions: [action(ACTION_A)],
      client_proven_patterns: [],
      client_failed_experiments: [],
      client_learned_preferences: [],
      client_decision_history: [],
    }
    const { supabase, inserted } = makeSupabase(tables)
    await runExtractorForClient(supabase, CLIENT)

    const row = inserted.client_proven_patterns[0]
    expect(row.source_table).toBe('flywheel_actions')
    expect(row.source_id).toBe(ACTION_A)
    expect(row.source_id).not.toBe('outcome-xyz')
  })

  it('同一批里同一个动作出现两次，也只写一条', async () => {
    const tables: Record<string, Row[]> = {
      // 理论上归因保证一动作一结论，但抽取器不该依赖上游永不出错
      flywheel_outcomes: [outcome('o1', ACTION_A), outcome('o2', ACTION_A)],
      flywheel_actions: [action(ACTION_A)],
      client_proven_patterns: [],
      client_failed_experiments: [],
      client_learned_preferences: [],
      client_decision_history: [],
    }
    const { supabase, inserted } = makeSupabase(tables)

    const res = await runExtractorForClient(supabase, CLIENT)
    expect(res.patterns_added).toBe(1)
    expect(inserted.client_proven_patterns).toHaveLength(1)
  })

  it('不同动作各写各的，去重不会误伤', async () => {
    const tables: Record<string, Row[]> = {
      flywheel_outcomes: [outcome('o1', ACTION_A), outcome('o2', ACTION_B)],
      flywheel_actions: [action(ACTION_A), action(ACTION_B, 'geo.deploy_directive')],
      client_proven_patterns: [],
      client_failed_experiments: [],
      client_learned_preferences: [],
      client_decision_history: [],
    }
    const { supabase } = makeSupabase(tables)

    const res = await runExtractorForClient(supabase, CLIENT)
    expect(res.patterns_added).toBe(2)
  })

  it('偏好条目的次数涨了，只是同一条经验更可信，不该新增一行', async () => {
    // 3 个不同动作、同一 action_type → 触发 preference（阈值 3）
    const ids = ['aaa', 'bbb', 'ccc'].map((s) => `${s}11111-1111-1111-1111-111111111111`)
    const tables: Record<string, Row[]> = {
      flywheel_outcomes: ids.map((id, i) => outcome(`o${i}`, id)),
      flywheel_actions: ids.map((id) => action(id, 'blog_publish')),
      client_proven_patterns: [],
      client_failed_experiments: [],
      client_learned_preferences: [],
      client_decision_history: [],
    }
    const { supabase, inserted } = makeSupabase(tables)

    const first = await runExtractorForClient(supabase, CLIENT)
    expect(first.preferences_added).toBe(1)
    expect(inserted.client_learned_preferences[0].content).toContain('3 次 confirmed')

    // 又累积了一次 confirmed：content 会变成「4 次」，但这不是一条新经验
    const fourth = 'ddd11111-1111-1111-1111-111111111111'
    tables.flywheel_outcomes.push(outcome('o3', fourth))
    tables.flywheel_actions.push(action(fourth, 'blog_publish'))

    const second = await runExtractorForClient(supabase, CLIENT)
    expect(second.preferences_added).toBe(0)                        // ← 回归点
    expect(inserted.client_learned_preferences).toHaveLength(1)
  })

  it('去重集合读失败时，宁可这轮不记，也不照写', async () => {
    const tables: Record<string, Row[]> = {
      flywheel_outcomes: [outcome('o1', ACTION_A)],
      flywheel_actions: [action(ACTION_A)],
      client_proven_patterns: [],
      client_failed_experiments: [],
      client_learned_preferences: [],
      client_decision_history: [],
    }
    const { supabase, inserted } = makeSupabase(tables)

    // 让读去重集合的那张表报错
    const original = (supabase as { from: (t: string) => unknown }).from
    ;(supabase as { from: (t: string) => unknown }).from = (t: string) => {
      if (t === 'client_proven_patterns') {
        const bad: Record<string, unknown> = {
          select: () => bad, eq: () => bad, not: () => bad, order: () => bad,
          range: () => Promise.resolve({ data: null, error: { message: '连不上' } }),
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
        }
        return bad
      }
      return (original as (t: string) => unknown)(t)
    }

    const res = await runExtractorForClient(supabase, CLIENT)
    expect(res.patterns_added).toBe(0)
    expect(inserted.client_proven_patterns ?? []).toHaveLength(0)
    expect(res.errors.join()).toContain('避免写重')
  })
})
