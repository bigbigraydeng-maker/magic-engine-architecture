/**
 * 记一笔人工接触。
 *
 * 这里只钉一件事，但它决定「说好周五给报价，周五名单上就有他」成不成立：
 * **相对日期按「这通电话什么时候打的」算，不是按「什么时候录进系统的」。**
 *
 * 这个接口本来就支持补记（路由注释写着「补记历史电话是常态」）。补记昨天那通
 * 电话、笔记里写「明天上午再打」—— 拿录入时间当基准的话，「明天」会按今天算，
 * **下一步整整晚一天排上**，而销售以为已经排好了。他不会发现，客人也不会。
 *
 * （Codex 复审 2026-08-15 第五轮指出，是新加的相对日期解析自带的缺陷。）
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))
vi.mock('@/lib/crm/note-parser', () => ({
  parseNote: vi.fn(),
}))

import { supabaseAdmin } from '@/lib/supabase'
import { parseNote } from '@/lib/crm/note-parser'
import { recordManualTouchpoint } from '../touchpoints'

const EMPTY_PARSE = {
  outcome: 'spoke' as const,
  do_not_contact: false,
  travel_window: null,
  tour_interest: null,
  competitor: null,
  callback_at: null,
  summary: '聊了聊',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(parseNote).mockResolvedValue(EMPTY_PARSE)
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === 'contact_touchpoints') {
      return {
        upsert: () => ({
          select: () => ({ maybeSingle: async () => ({ data: { id: 'tp-1' }, error: null }) }),
        }),
      } as never
    }
    if (table === 'contacts') {
      return {
        update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
      } as never
    }
    throw new Error(`没预料到的表：${table}`)
  })
})

const record = (over: Partial<Parameters<typeof recordManualTouchpoint>[0]> = {}) =>
  recordManualTouchpoint({
    clientId: 'cts',
    contactId: 'c1',
    direction: 'outbound',
    note: '聊得不错，明天上午再打给他',
    occurredAt: '2026-08-05T04:00:00.000Z',
    clientRef: 'ref-1',
    timeZone: 'Pacific/Auckland',
    ...over,
  })

describe('相对日期按通话时间算，不按录入时间', () => {
  it('把这通电话的发生时间传给解析器当基准', async () => {
    await record({ occurredAt: '2026-08-04T04:00:00.000Z' })
    const opts = vi.mocked(parseNote).mock.calls[0][1]
    expect(opts?.now?.toISOString()).toBe('2026-08-04T04:00:00.000Z')
  })

  it('客户所在地的时区也一起传 —— 「上午 9 点」是哪个 9 点要靠它', async () => {
    await record({ timeZone: 'Australia/Sydney' })
    expect(vi.mocked(parseNote).mock.calls[0][1]?.timeZone).toBe('Australia/Sydney')
  })

  /**
   * 时间坏掉时退回「现在」，**不能把 Invalid Date 递下去** ——
   * 那会让解析器推不出任何日期，callback 静悄悄变成 null：
   * 少排一次跟进，而且没有任何人会发现。
   */
  it('时间坏掉：退回「现在」，不把坏日期递下去', async () => {
    await record({ occurredAt: '不是时间' })
    const now = vi.mocked(parseNote).mock.calls[0][1]?.now
    expect(now).toBeInstanceOf(Date)
    expect(Number.isNaN(now!.getTime())).toBe(false)
  })

  /** 已经解析好的（批量场景 / 一键动作）不该再调解析器 —— 白花钱又慢。 */
  it('调用方给了解析结果就不再调 AI', async () => {
    await record({ parsed: EMPTY_PARSE })
    expect(parseNote).not.toHaveBeenCalled()
  })
})
