/**
 * migration SQL 的契约测试 —— fake store 的行为规约必须与 SQL 同步
 * (memory 教训:只改假件不改 SQL = 测试全绿生产报错)。
 *
 * 诚实声明:这是文本级契约钉扎,不是跑真库;它保证的是「承重条款没被删改」,
 * apply 后的行为由 canary(admin refresh)验证。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SQL = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '20260815000001_product_map_sync_v1.sql'),
  'utf8',
)

describe('migration 承重条款', () => {
  it('五张表的 RLS policy 全部带 TO service_role(漏了 = 对匿名访客敞开)', () => {
    const policies = SQL.match(/CREATE POLICY[^;]+;/g) ?? []
    expect(policies.length).toBe(5)
    for (const p of policies) {
      expect(p, p).toContain('TO service_role')
    }
  })

  it('RPC 有逐行单调守卫(observed_at 旧的不覆盖新行)—— PR 与 issue 两个循环各一道', () => {
    const guards = SQL.match(/v_existing_obs >= \(v_fact->>'observed_at'\)::timestamptz/g) ?? []
    expect(guards.length).toBe(2)
    const counters = SQL.match(/v_skipped_stale := v_skipped_stale \+ 1/g) ?? []
    expect(counters.length).toBe(2)
  })

  it('unclassified 收编只在 full 模式', () => {
    expect(SQL).toContain("IF p_mode = 'full' THEN")
  })

  it("mergeable 'unknown' 不覆盖已知值", () => {
    expect(SQL).toContain("WHEN EXCLUDED.mergeable_state = 'unknown'")
  })

  it('threads 抓取失败(null)留旧值', () => {
    expect(SQL).toContain('COALESCE(EXCLUDED.unresolved_threads, product_map_pr_facts.unresolved_threads)')
  })

  it('RPC 权限收口:REVOKE PUBLIC + GRANT service_role(6 参数签名)', () => {
    expect(SQL).toContain('REVOKE ALL ON FUNCTION product_map_commit_sync_v1(jsonb, jsonb, jsonb, jsonb, text, jsonb)')
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION product_map_commit_sync_v1(jsonb, jsonb, jsonb, jsonb, text, jsonb)')
  })

  it('skippedStale 回写 run 行(不回写 = 生产台账恒 0,只有返回值是真的)', () => {
    expect(SQL).toContain("jsonb_set(COALESCE(stats, '{}'::jsonb), '{skippedStale}', to_jsonb(v_skipped_stale))")
  })

  it('收编只按显式 p_resolve 名单 —— 绝无「没扫到 = 已收编」的反推 sweep', () => {
    expect(SQL).toContain('p_resolve')
    // 'AND NOT EXISTS' 是老 sweep 的特征形状(CREATE ... IF NOT EXISTS 无关)
    expect(SQL).not.toContain('AND NOT EXISTS')
  })

  it('policy 幂等(duplicate_object 包裹)—— SQL Editor 半途重跑不许卡死', () => {
    const wraps = SQL.match(/EXCEPTION WHEN duplicate_object THEN NULL/g) ?? []
    expect(wraps.length).toBe(5)
  })

  it('deliveries 主键是 GitHub delivery GUID(幂等的物理基础)', () => {
    expect(SQL).toMatch(/delivery_id\s+text PRIMARY KEY/)
  })
})
