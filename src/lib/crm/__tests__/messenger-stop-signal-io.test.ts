/**
 * 取数那一半（`findMessengerStopSignals`）—— 重点钉两件在生产才会炸的事。
 *
 * 🔴 **`.in()` 必须分批**（Codex 复审 PR #1037，2026-08-17）：CTS 线上 658 个
 * 会话，一次全塞进 PostgREST 的查询串光 UUID 就约 24 KB，请求会在到数据库
 * 之前因 URL 过长失败。而这条通道的异常被 `loadManualItems` 的 catch 吞掉 ——
 * 结果是整条通道只留一行日志、一条待办都不下发。这正是铁律 3
 * 「发现不许死在日志里」要防的那种失败，所以必须有测试钉住。
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { findMessengerStopSignals } from '../messenger-stop-signal'

type Row = Record<string, unknown>

/** 每次 `.in()` 收到了多少个 id —— 分批没做对，这里就会出现大于 100 的数。 */
const inSizes: number[] = []

function makeFake(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    if (!(table in tables)) throw new Error(`fake supabase: 表 '${table}' 没建模`)
    const filters: Array<(r: Row) => boolean> = []
    const api: Record<string, unknown> = {}
    const chain = () => api
    api.select = () => chain()
    api.order = () => chain()
    api.eq = (c: string, v: unknown) => (filters.push((r) => r[c] === v), chain())
    api.gte = (c: string, v: string) =>
      (filters.push((r) => String(r[c]) >= v), chain())
    api.not = (c: string, _op: string, _v: unknown) =>
      (filters.push((r) => r[c] != null), chain())
    api.in = (c: string, v: unknown[]) => {
      inSizes.push(v.length)
      filters.push((r) => v.includes(r[c]))
      return chain()
    }
    // fetchAll 走 range；这里一次给全，行数远小于一页。
    api.range = (fromIdx: number) =>
      Promise.resolve({
        data: fromIdx > 0 ? [] : tables[table].filter((r) => filters.every((f) => f(r))),
        error: null,
      })
    return api
  }
  return { from } as unknown as SupabaseClient
}

const NOW = new Date('2026-08-17T00:00:00Z')
const CLIENT = 'c1'

describe('findMessengerStopSignals', () => {
  it('端到端：客人私信说 do not follow up → 挑出来一条', async () => {
    inSizes.length = 0
    const res = await findMessengerStopSignals(
      makeFake({
        conversations: [{ id: 'v1', client_id: CLIENT, contact_id: 'p1', channel: 'messenger' }],
        conversation_messages: [
          {
            id: 'm1',
            conversation_id: 'v1',
            direction: 'inbound',
            body: 'do not follow up',
            sent_at: '2026-08-15T00:00:00Z',
          },
        ],
        contact_touchpoints: [],
        contacts: [{ id: 'p1', do_not_contact: false }],
      }),
      [CLIENT],
      NOW,
    )
    expect(res.signals).toHaveLength(1)
    expect(res.signals[0].contactId).toBe('p1')
  })

  it('窗口之外的旧私信不算', async () => {
    inSizes.length = 0
    const res = await findMessengerStopSignals(
      makeFake({
        conversations: [{ id: 'v1', client_id: CLIENT, contact_id: 'p1', channel: 'messenger' }],
        conversation_messages: [
          {
            id: 'm1',
            conversation_id: 'v1',
            direction: 'inbound',
            body: 'do not follow up',
            // 90 天前
            sent_at: '2026-05-19T00:00:00Z',
          },
        ],
        contact_touchpoints: [],
        contacts: [{ id: 'p1', do_not_contact: false }],
      }),
      [CLIENT],
      NOW,
    )
    expect(res.signals).toEqual([])
  })

  it('🔴 658 个会话时 .in() 每次都不超过 100 个 id', async () => {
    inSizes.length = 0
    const convos = Array.from({ length: 658 }, (_, i) => ({
      id: `v${i}`,
      client_id: CLIENT,
      contact_id: `p${i}`,
      channel: 'messenger',
    }))
    const msgs = convos.map((c, i) => ({
      id: `m${i}`,
      conversation_id: c.id,
      direction: 'inbound',
      body: 'do not follow up',
      sent_at: '2026-08-15T00:00:00Z',
    }))
    await findMessengerStopSignals(
      makeFake({
        conversations: convos,
        conversation_messages: msgs,
        contact_touchpoints: [],
        contacts: convos.map((c) => ({ id: c.contact_id, do_not_contact: false })),
      }),
      [CLIENT],
      NOW,
    )
    // client_id 那次 in 只有 1 个，其余都是分批过的
    expect(Math.max(...inSizes)).toBeLessThanOrEqual(100)
    // 真的分批了（658 条会话 → 至少 7 批），不是因为压根没查
    expect(inSizes.filter((n) => n === 100).length).toBeGreaterThanOrEqual(7)
  })
})
