/**
 * 落库层：幂等与并发。
 *
 * 这里守的是「重放 / 并发不能产生重复行」和「读不到绝不写进 metric_value」。
 * 前者只有数据库唯一约束能保证 —— 所以这些测试断言的是「撞了 23505 之后的行为」，
 * 不是「先查询再插入」那种在并发下必漏的写法。
 */

import { describe, it, expect, vi } from 'vitest'
import {
  recordPublishAction,
  upsertMeasurementReceipt,
  writePostMetric,
  SOCIAL_PUBLISH_ACTION_TYPE,
} from '../post-measurement-store'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const PAGE = '1616575215312482'
const POST = `${PAGE}_1750182150247306`
const KEY = 'campaign_daily::c0000000::2026-09-03::post'
const ACTION = 'aaaaaaaa-0000-0000-0000-000000000001'

function actionInput() {
  return {
    clientId: CLIENT,
    idempotencyKey: KEY,
    postId: POST,
    pageId: PAGE,
    permalink: 'https://www.facebook.com/CTSTOURS/posts/abc',
    campaignId: '6612eabf-dd7e-47f0-bcc4-e6a7fd813aea',
    planId: 'f166a5c0-b2df-478c-8b04-1168ef2d3641',
    publishedAt: '2026-09-03T06:00:00.000Z',
    measureAt: [{ hours: 4, at: '2026-09-03T10:00:00.000Z' }],
  }
}

/** 只对本功能会碰的表建模；碰别的表就炸，暴露越界写入。 */
function fakeDb(opts: {
  insertResult?: { data?: unknown; error?: unknown }
  existingRow?: unknown
  onInsert?: (table: string, row: Record<string, unknown>) => void
}) {
  const ALLOWED = ['flywheel_actions', 'flywheel_metrics', 'social_post_measurement_receipts']
  return {
    from(table: string) {
      if (!ALLOWED.includes(table)) throw new Error(`fake db: table '${table}' is not modelled`)
      const chain: Record<string, unknown> = {}
      chain.insert = (row: Record<string, unknown>) => {
        opts.onInsert?.(table, row)
        const result = opts.insertResult ?? { data: { id: ACTION }, error: null }
        chain.select = () => chain
        chain.single = () => Promise.resolve(result)
        // flywheel_metrics 的 insert 不 select，直接 await
        return Object.assign(Promise.resolve(result), chain)
      }
      chain.upsert = (row: Record<string, unknown>) => {
        opts.onInsert?.(table, row)
        chain.select = () => chain
        chain.single = () => Promise.resolve(opts.insertResult ?? { data: { id: 'receipt-1' }, error: null })
        return chain
      }
      chain.select = () => chain
      chain.eq = () => chain
      chain.maybeSingle = () => Promise.resolve({ data: opts.existingRow ?? null, error: null })
      return chain
    },
  } as never
}

describe('recordPublishAction', () => {
  it('🔴 expected_metric 必须是 NULL —— 否则通用归因会把同客户不同帖子串起来', async () => {
    let written: Record<string, unknown> | null = null
    await recordPublishAction(fakeDb({ onInsert: (_t, row) => { written = row } }), actionInput())
    expect(written).not.toBeNull()
    expect(written!.expected_metric).toBeNull()
    expect(written!.expected_delta).toBeNull()
  })

  it('vendor / execution_mode 是 Meta 直连，不是 Publer', async () => {
    let written: Record<string, unknown> | null = null
    await recordPublishAction(fakeDb({ onInsert: (_t, row) => { written = row } }), actionInput())
    expect(written!.vendor).toBe('meta_graph')
    expect(written!.execution_mode).toBe('in_house')
    expect(written!.action_type).toBe(SOCIAL_PUBLISH_ACTION_TYPE)
  })

  it('🔴 排期帖的 executed_at 用公开时刻，不是提交时刻', async () => {
    let written: Record<string, unknown> | null = null
    await recordPublishAction(
      fakeDb({ onInsert: (_t, row) => { written = row } }),
      { ...actionInput(), scheduledPublishTime: '2026-09-05T20:00:00.000Z' },
    )
    expect(written!.executed_at).toBe('2026-09-05T20:00:00.000Z')
  })

  it('13/14. 🔴 并发撞唯一约束(23505) → 回读原行，不产生第二条动作', async () => {
    const id = await recordPublishAction(
      fakeDb({
        insertResult: { data: null, error: { code: '23505', message: 'duplicate key' } },
        existingRow: { id: ACTION },
      }),
      actionInput(),
    )
    expect(id).toBe(ACTION)
  })

  it('撞约束但回读不到 → 抛错，不静默返回一个假 id', async () => {
    await expect(
      recordPublishAction(
        fakeDb({ insertResult: { data: null, error: { code: '23505', message: 'dup' } }, existingRow: null }),
        actionInput(),
      ),
    ).rejects.toThrow(/not readable/)
  })

  it('回执数组不写进 action payload —— 两个窗口并发会互相覆盖', async () => {
    let written: Record<string, unknown> | null = null
    await recordPublishAction(fakeDb({ onInsert: (_t, row) => { written = row } }), actionInput())
    const payload = written!.payload as Record<string, unknown>
    expect(payload).not.toHaveProperty('measurements')
    expect(payload.measure_at).toEqual([{ hours: 4, at: '2026-09-03T10:00:00.000Z' }])
  })
})

describe('upsertMeasurementReceipt', () => {
  it('12/15. 🔴 无法测量写回执，绝不写进 metric —— 回执里 values 空、status 是 unmeasurable', async () => {
    let written: Record<string, unknown> | null = null
    let touchedTable: string | null = null
    await upsertMeasurementReceipt(
      fakeDb({ onInsert: (t, row) => { touchedTable = t; written = row } }),
      {
        clientId: CLIENT, actionId: ACTION, idempotencyKey: KEY, postId: POST, pageId: PAGE,
        windowHours: 72, targetAt: '2026-09-06T06:00:00.000Z', measuredAt: null,
        status: 'unmeasurable', values: {}, missing: {}, reason: 'object_gone',
        graphCode: 100, graphSubcode: 33,
      },
    )
    expect(touchedTable).toBe('social_post_measurement_receipts')
    expect(written!.status).toBe('unmeasurable')
    expect(written!.values).toEqual({})
    expect(written!.reason).toBe('object_gone')
    // metric_value 是 NOT NULL —— 这条路径从头到尾没碰 flywheel_metrics。
  })

  it('同一 (action_id, window_hours) 走 upsert，不新增第二行', async () => {
    let written: Record<string, unknown> | null = null
    const db = {
      from(table: string) {
        const chain: Record<string, unknown> = {}
        chain.upsert = (row: Record<string, unknown>, opts: { onConflict?: string }) => {
          written = { ...row, __onConflict: opts?.onConflict }
          chain.select = () => chain
          chain.single = () => Promise.resolve({ data: { id: 'r1' }, error: null })
          return chain
        }
        return chain
      },
    } as never
    await upsertMeasurementReceipt(db, {
      clientId: CLIENT, actionId: ACTION, idempotencyKey: KEY, postId: POST, pageId: PAGE,
      windowHours: 4, targetAt: '2026-09-03T10:00:00.000Z', measuredAt: '2026-09-03T10:00:05.000Z',
      status: 'ok', values: { likes: 3 }, missing: {},
    })
    expect(written!.__onConflict).toBe('action_id,window_hours')
  })
})

describe('writePostMetric', () => {
  it('source_ref 带齐单帖身份 —— 这是唯一能按帖子查回来的路', async () => {
    let written: Record<string, unknown> | null = null
    await writePostMetric(fakeDb({ onInsert: (_t, row) => { written = row } }), {
      clientId: CLIENT, metricKey: 'social.post.likes', value: 10,
      actionId: ACTION, idempotencyKey: KEY, postId: POST, pageId: PAGE,
      windowHours: 4, targetAt: '2026-09-03T10:00:00.000Z', receiptId: 'r1',
      measuredAt: '2026-09-03T10:00:05.000Z',
    })
    expect(written!.metric_value).toBe(10)
    expect(written!.source).toBe('meta_graph')
    expect(written!.source_ref).toMatchObject({
      action_id: ACTION, idempotency_key: KEY, post_id: POST, window_hours: 4, receipt_id: 'r1',
    })
  })

  it('13. 🔴 重放撞唯一约束 → 复用原行，不产生重复数字', async () => {
    const r = await writePostMetric(
      fakeDb({ insertResult: { data: null, error: { code: '23505', message: 'dup' } } }),
      {
        clientId: CLIENT, metricKey: 'social.post.likes', value: 10,
        actionId: ACTION, idempotencyKey: KEY, postId: POST, pageId: PAGE,
        windowHours: 4, targetAt: '2026-09-03T10:00:00.000Z', receiptId: 'r1',
        measuredAt: '2026-09-03T10:00:05.000Z',
      },
    )
    expect(r).toBe('already_present')
  })

  it('别的数据库错误照常抛 —— 不许把真失败吞成 already_present', async () => {
    await expect(
      writePostMetric(fakeDb({ insertResult: { data: null, error: { code: '42P01', message: 'no table' } } }), {
        clientId: CLIENT, metricKey: 'social.post.likes', value: 1,
        actionId: ACTION, idempotencyKey: KEY, postId: POST, pageId: PAGE,
        windowHours: 4, targetAt: '2026-09-03T10:00:00.000Z', receiptId: 'r1',
        measuredAt: '2026-09-03T10:00:05.000Z',
      }),
    ).rejects.toThrow(/no table/)
  })
})
