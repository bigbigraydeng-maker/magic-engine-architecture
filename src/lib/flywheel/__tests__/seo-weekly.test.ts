/**
 * 每周 SEO 快照的纯逻辑测试。
 *
 * 这条链路花钱，所以测的重点不是「跑通了」，而是三件**花钱相关**的事：
 *   1. 谁会被扫（名单判据不能悄悄放宽）
 *   2. 同一周重复触发会不会重复付款（去重键）
 *   3. 失败时钱花了几次有没有如实记下（回执不许低报）
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  FLYWHEEL_SEO_SNAPSHOT_DUE_EVENT,
  FLYWHEEL_SEO_WEEKLY_CRON,
  isoWeekKey,
  loadSnapshotRoster,
  parseSnapshotDue,
  PROVIDER_CALLS_PER_CLIENT,
  snapshotEventId,
  snapshotOneClient,
} from '../seo-weekly'

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'

/**
 * 假 supabase 按**表**建模，不按调用顺序建模 —— 按顺序建模的假件，
 * 一旦真实代码换个顺序查就会假绿（本仓踩过）。
 */
function fakeSupabase(tables: {
  clients?: { data: unknown[] | null; error: { message: string } | null }
}): SupabaseClient {
  const builder = (table: string) => {
    const result = tables[table as 'clients'] ?? { data: [], error: null }
    const chain = {
      select: () => chain,
      eq: () => chain,
      not: () => Promise.resolve(result),
    }
    return chain
  }
  return { from: builder } as unknown as SupabaseClient
}

describe('谁会被扫 —— 名单判据', () => {
  it('在服务中 + 填了网址 的才进名单，网址两边空白会被削掉', async () => {
    const r = await loadSnapshotRoster(
      fakeSupabase({
        clients: {
          data: [
            { id: CTS, domain: '  ctstours.co.nz ' },
            { id: OZTOP, domain: 'oztopbuildingsupplies.com.au' },
          ],
          error: null,
        },
      }),
    )
    expect(r.ok).toBe(true)
    expect(r.ok && r.entries).toEqual([
      { clientId: CTS, domain: 'ctstours.co.nz' },
      { clientId: OZTOP, domain: 'oztopbuildingsupplies.com.au' },
    ])
  })

  it('网址是空串 / 纯空白 / 不是字符串 的一律不进名单 —— 拿它去扫等于白花钱', async () => {
    const r = await loadSnapshotRoster(
      fakeSupabase({
        clients: {
          data: [
            { id: CTS, domain: '' },
            { id: CTS, domain: '   ' },
            { id: CTS, domain: 123 },
            { id: '', domain: 'x.co.nz' },
          ],
          error: null,
        },
      }),
    )
    expect(r.ok && r.entries).toEqual([])
  })

  it('🔴 查名单失败必须报出来，不许当成「今天没人要扫」', async () => {
    const r = await loadSnapshotRoster(
      fakeSupabase({ clients: { data: null, error: { message: 'boom' } } }),
    )
    expect(r).toEqual({ ok: false, reason: 'boom' })
  })
})

describe('重复触发不许重复付款 —— 去重键', () => {
  it('ISO 周编号：同一周的任意一天算同一周', () => {
    // 2026-09-07 是周一，2026-09-13 是周日 —— 同一个 ISO 周
    expect(isoWeekKey(new Date('2026-09-07T00:00:00Z'))).toBe(
      isoWeekKey(new Date('2026-09-13T23:59:59Z')),
    )
  })

  it('🔴 跨周必须变 —— 不变的话下周的快照会被当成重复而丢掉', () => {
    expect(isoWeekKey(new Date('2026-09-13T00:00:00Z'))).not.toBe(
      isoWeekKey(new Date('2026-09-14T00:00:00Z')), // 周日 → 周一，进入下一周
    )
  })

  it('去重键 = 客户 + 周：同客户同周一致，换客户或换周就变', () => {
    const wk = isoWeekKey(new Date('2026-09-07T00:00:00Z'))
    expect(snapshotEventId(CTS, wk)).toBe(snapshotEventId(CTS, wk))
    expect(snapshotEventId(CTS, wk)).not.toBe(snapshotEventId(OZTOP, wk))
    expect(snapshotEventId(CTS, wk)).not.toBe(snapshotEventId(CTS, '2026-W40'))
  })
})

describe('派单条子 fail-closed —— 后面就是花钱的调用', () => {
  const wk = '2026-W37'
  it('合法条子放行', () => {
    expect(parseSnapshotDue({ client_id: CTS, domain: 'ctstours.co.nz', week_key: wk })).toEqual({
      ok: true,
      value: { client_id: CTS, domain: 'ctstours.co.nz', week_key: wk },
    })
  })

  it('🔴 客户 id 不是 uuid / 网址空 / 周编号不合法 → 一律拒，不许「缺了当默认值继续」', () => {
    const bad = [
      null,
      'not-an-object',
      { client_id: 'nope', domain: 'x.co.nz', week_key: wk },
      { client_id: CTS, domain: '  ', week_key: wk },
      { client_id: CTS, domain: 'x.co.nz', week_key: '2026-W00' },
      { client_id: CTS, domain: 'x.co.nz', week_key: '2026-W54' },
      { client_id: CTS, domain: 'x.co.nz' },
    ]
    for (const raw of bad) expect(parseSnapshotDue(raw).ok, JSON.stringify(raw)).toBe(false)
  })
})

describe('回执不许低报花费', () => {
  const due = { client_id: CTS, domain: 'ctstours.co.nz', week_key: '2026-W37' } as const

  it('成功：写了几行如实报，并标明这条链路不对外发布任何东西', async () => {
    const r = await snapshotOneClient(due, async () => [{}, {}, {}], new Date('2026-09-07T00:00:00Z'))
    expect(r.status).toBe('completed')
    expect(r.metrics_written).toBe(3)
    expect(r.provider_calls).toBe(PROVIDER_CALLS_PER_CLIENT)
    expect(r.no_publish).toBe(true)
    expect(r.created_at).toBe('2026-09-07T00:00:00.000Z')
  })

  it('🔴 失败也要出回执、也要如实记花费 —— 钱已经花了，报 0 是骗人', async () => {
    const r = await snapshotOneClient(due, async () => {
      throw new Error('dataforseo 429')
    })
    expect(r.status).toBe('failed')
    expect(r.error).toBe('dataforseo 429')
    expect(r.metrics_written).toBe(0)
    expect(r.provider_calls).toBe(PROVIDER_CALLS_PER_CLIENT)
  })

  it('🔴 失败不许往外抛 —— 抛出去 Inngest 会重试，等于再付一次钱', async () => {
    await expect(
      snapshotOneClient(due, async () => {
        throw new Error('boom')
      }),
    ).resolves.toBeDefined()
  })
})

describe('对外契约（改了会连累别人）', () => {
  it('事件名是云端专属、业务可读', () => {
    expect(FLYWHEEL_SEO_SNAPSHOT_DUE_EVENT).toBe('flywheel/seo.snapshot.due')
  })
  it('周期是每周一次的五段式表达式', () => {
    expect(FLYWHEEL_SEO_WEEKLY_CRON.split(/\s+/)).toHaveLength(5)
  })
})
