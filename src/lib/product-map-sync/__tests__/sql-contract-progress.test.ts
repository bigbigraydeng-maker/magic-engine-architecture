/**
 * 20260817000001 迁移(摘要缓存列 + 每日进度快照)的文本级契约钉扎 —— 同 sql-contract.test.ts
 * 的诚实声明:这不是跑真库,是保证承重条款没被删改;apply 后行为由 canary 验证。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SQL = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '20260817000001_product_map_progress_and_summary_v1.sql'),
  'utf8',
)

describe('迁移承重条款(进度快照 + 摘要缓存)', () => {
  it('两张既有表各加两列摘要缓存(可空,不带 DEFAULT NOT NULL —— 否则老行会插入失败)', () => {
    expect(SQL).toContain('ADD COLUMN IF NOT EXISTS human_summary text')
    expect(SQL).toContain('ADD COLUMN IF NOT EXISTS human_summary_generated_at timestamptz')
    const alters = SQL.match(/ALTER TABLE product_map_(pr|issue)_facts/g) ?? []
    expect(alters.length).toBe(2)
  })

  it('新表 RLS 显式 TO service_role(2026-08-03 事故教训 —— 漏了 = 对匿名访客敞开)', () => {
    const policies = SQL.match(/CREATE POLICY[^;]+;/g) ?? []
    expect(policies.length).toBe(1)
    expect(policies[0]).toContain('TO service_role')
    expect(SQL).toContain('ALTER TABLE product_map_progress_snapshots ENABLE ROW LEVEL SECURITY')
  })

  it('snapshot_date 是主键(一天一行,天然幂等 upsert 目标)', () => {
    expect(SQL).toContain('snapshot_date        date PRIMARY KEY')
  })

  it('单调 upsert 守卫:只有 run_started_at 更晚(或相等)的写入能覆盖已有行(魏征设计审并发必改项)', () => {
    expect(SQL).toContain(
      'WHERE excluded.run_started_at >= product_map_progress_snapshots.run_started_at',
    )
  })

  it('RPC 权限收口:GRANT EXECUTE 给 service_role', () => {
    expect(SQL).toContain(
      'GRANT EXECUTE ON FUNCTION product_map_upsert_progress_snapshot_v1(',
    )
    expect(SQL).toContain('TO service_role')
  })

  it('sync_run_id 外键指回 product_map_sync_runs —— 快照必须挂在真实存在的一轮同步上', () => {
    expect(SQL).toContain('REFERENCES product_map_sync_runs (id)')
  })
})
