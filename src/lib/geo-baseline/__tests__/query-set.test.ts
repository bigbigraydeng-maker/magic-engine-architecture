/**
 * 查询集读取 / 首版写入判据（Issue #883 / #917 · WP04A）。
 *
 * 🔴 重点：**「查不到」和「查炸了」必须分得开**。前者是「PM 还没批问题」，
 *    后者是数据库抖了一下 —— 两件事都返回空数组的话，第一次真实基线会把
 *    一次故障读成一次「还没准备好」，然后有人去催 PM 批一份早就批过的东西。
 */

import { describe, expect, it } from 'vitest'
import { createQuerySet, loadFrozenQueryScope } from '../query-set'
import { FakeSupabase } from './fake-supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

const CLIENT = 'client-1'

function db(): { fake: FakeSupabase; sb: SupabaseClient } {
  const fake = new FakeSupabase()
  return { fake, sb: fake as unknown as SupabaseClient }
}

function seedSet(fake: FakeSupabase, opts: { locked?: string | null } = {}): void {
  fake.tables.geo_query_sets.push({
    id: 'qs-1',
    client_id: CLIENT,
    query_set_version: 'roman-baseline-v1',
    locked_at: opts.locked ?? null,
    created_by: 'pm',
  })
  fake.tables.geo_queries.push(
    { id: 'q-b', client_id: CLIENT, query_set_id: 'qs-1', query_key: 'b-key', question_text: 'B?', is_active: true },
    { id: 'q-a', client_id: CLIENT, query_set_id: 'qs-1', query_key: 'a-key', question_text: 'A?', is_active: true },
    { id: 'q-x', client_id: CLIENT, query_set_id: 'qs-1', query_key: 'x-key', question_text: 'X?', is_active: false },
  )
}

describe('读取冻结的查询范围', () => {
  it('按 query_key 稳定排序（顺序会影响样本展开顺序，飘了就对不上号）', async () => {
    const { fake, sb } = db()
    seedSet(fake)
    const scope = await loadFrozenQueryScope(sb, { clientId: CLIENT, querySetVersion: 'roman-baseline-v1' })
    expect(scope.queries.map((q) => q.queryKey)).toEqual(['a-key', 'b-key'])
  })

  it('停用的问题不进范围（弃用靠停用标记，不靠删除）', async () => {
    const { fake, sb } = db()
    seedSet(fake)
    const scope = await loadFrozenQueryScope(sb, { clientId: CLIENT, querySetVersion: 'roman-baseline-v1' })
    expect(scope.queries.map((q) => q.queryKey)).not.toContain('x-key')
  })

  it('未锁定 ⇒ lockedAt 记 not_applicable（这一列刻意没有 unknown_reason 列）', async () => {
    const { fake, sb } = db()
    seedSet(fake)
    const scope = await loadFrozenQueryScope(sb, { clientId: CLIENT, querySetVersion: 'roman-baseline-v1' })
    expect(scope.lockedAt).toEqual({ known: false, reason: 'not_applicable' })
  })

  it('已锁定 ⇒ 带出锁定时间', async () => {
    const { fake, sb } = db()
    seedSet(fake, { locked: '2026-08-12T00:00:00.000Z' })
    const scope = await loadFrozenQueryScope(sb, { clientId: CLIENT, querySetVersion: 'roman-baseline-v1' })
    expect(scope.lockedAt).toEqual({ known: true, value: '2026-08-12T00:00:00.000Z' })
  })

  it('跨客户读不到别人的查询集', async () => {
    const { fake, sb } = db()
    seedSet(fake)
    await expect(
      loadFrozenQueryScope(sb, { clientId: 'someone-else', querySetVersion: 'roman-baseline-v1' }),
    ).rejects.toMatchObject({ code: 'query_set_not_found' })
  })
})

describe('「空」的两种来路必须分得开', () => {
  it('集合真的不存在 ⇒ query_set_not_found', async () => {
    const { sb } = db()
    await expect(
      loadFrozenQueryScope(sb, { clientId: CLIENT, querySetVersion: 'nope' }),
    ).rejects.toMatchObject({ code: 'query_set_not_found' })
  })

  it('读集合炸了 ⇒ query_failed，不是 not_found（否则会去催 PM 批一份早就批过的东西）', async () => {
    const { fake, sb } = db()
    seedSet(fake)
    fake.failures.push({ table: 'geo_query_sets', op: 'select', message: 'connection reset' })
    await expect(
      loadFrozenQueryScope(sb, { clientId: CLIENT, querySetVersion: 'roman-baseline-v1' }),
    ).rejects.toMatchObject({ code: 'query_failed' })
  })

  it('集合在但一个启用问题都没有 ⇒ query_set_empty（不是「跑一个空基线」）', async () => {
    const { fake, sb } = db()
    fake.tables.geo_query_sets.push({
      id: 'qs-2',
      client_id: CLIENT,
      query_set_version: 'empty-v1',
      locked_at: null,
      created_by: 'pm',
    })
    await expect(
      loadFrozenQueryScope(sb, { clientId: CLIENT, querySetVersion: 'empty-v1' }),
    ).rejects.toMatchObject({ code: 'query_set_empty' })
  })

  it('读问题炸了 ⇒ query_failed，不是 empty', async () => {
    const { fake, sb } = db()
    seedSet(fake)
    fake.failures.push({ table: 'geo_queries', op: 'select', message: 'boom' })
    await expect(
      loadFrozenQueryScope(sb, { clientId: CLIENT, querySetVersion: 'roman-baseline-v1' }),
    ).rejects.toMatchObject({ code: 'query_failed' })
  })
})

describe('首版写入', () => {
  it('绝不写 locked_at —— 建集合时自带锁定时间会被库层守卫拒掉', async () => {
    const { fake, sb } = db()
    await createQuerySet(sb, {
      clientId: CLIENT,
      querySetVersion: 'v1',
      createdBy: 'pm@example.com',
      queries: [{ queryKey: 'k1', questionText: 'Q1?', locale: 'en-NZ', market: 'nz' }],
    })
    const payload = fake.insertPayloads.find((p) => p.table === 'geo_query_sets')
    expect(payload).toBeDefined()
    expect(Object.keys(payload!.rows[0])).not.toContain('locked_at')
  })

  it('locale / market 走「已知值 + 未知理由」双列，且恰好一个非空', async () => {
    const { fake, sb } = db()
    await createQuerySet(sb, {
      clientId: CLIENT,
      querySetVersion: 'v1',
      createdBy: 'pm@example.com',
      queries: [{ queryKey: 'k1', questionText: 'Q1?', locale: 'en-NZ', market: 'nz' }],
    })
    const row = fake.insertPayloads.find((p) => p.table === 'geo_queries')!.rows[0]
    expect(row.locale).toBe('en-NZ')
    expect(row.locale_unknown_reason).toBeNull()
    expect(row.market).toBe('nz')
    expect(row.market_unknown_reason).toBeNull()
  })

  it('种子里重复 queryKey ⇒ 拒（库层 UNIQUE 也会拒，但这里要给得出人话）', async () => {
    const { sb } = db()
    await expect(
      createQuerySet(sb, {
        clientId: CLIENT,
        querySetVersion: 'v1',
        createdBy: 'pm',
        queries: [
          { queryKey: 'k1', questionText: 'A?', locale: 'en-NZ', market: 'nz' },
          { queryKey: 'k1', questionText: 'B?', locale: 'en-NZ', market: 'nz' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'duplicate_query_key' })
  })

  it('空种子 ⇒ 拒', async () => {
    const { sb } = db()
    await expect(
      createQuerySet(sb, { clientId: CLIENT, querySetVersion: 'v1', createdBy: 'pm', queries: [] }),
    ).rejects.toMatchObject({ code: 'empty_seed' })
  })

  it('问题写失败 ⇒ 抛错并明说「集合尚未锁定，可以整体删掉重来」', async () => {
    const { fake, sb } = db()
    fake.failures.push({ table: 'geo_queries', op: 'insert', message: 'boom' })
    await expect(
      createQuerySet(sb, {
        clientId: CLIENT,
        querySetVersion: 'v1',
        createdBy: 'pm',
        queries: [{ queryKey: 'k1', questionText: 'Q?', locale: 'en-NZ', market: 'nz' }],
      }),
    ).rejects.toThrow(/尚未锁定/)
  })
})
