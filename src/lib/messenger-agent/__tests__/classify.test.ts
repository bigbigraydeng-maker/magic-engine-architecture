/**
 * `classifyConversation` —— 售前留资 vs 售后。
 *
 * 关键词样本取材自 issue #1576 验证要求里点名的五个真实场景短语（booking /
 * 我订的 / 我已付 / receipt / 我下单了），另配五条常见的售前留资开场白。
 * 边界测试钉住 30 天这个整数分界：卡在整 30 天不算售后，30 天零 1 秒才算
 * ——这条分界线本身就是 issue 明确要求的验证点，不是随手加的。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { classifyConversation } from '../classify'
import { supabaseAdmin } from '@/lib/supabase'

const mockFrom = vi.mocked(supabaseAdmin.from)

interface Row {
  body: string | null
  sent_at: string
}

/**
 * 拿一组消息行（已经按 sent_at 排好序）喂给 mock 的 supabase 链式调用。
 * `.range(from, to)` 真的按请求的区间切片返回——这样能测出「读全部消息要靠
 * 分页」这件事本身，而不是靠 mock 一次性把所有行都吐出来蒙混过关。
 */
function stubMessages(rows: Row[]) {
  mockFrom.mockImplementation((table: string) => {
    if (table !== 'conversation_messages') throw new Error(`fake supabase: 表 '${table}' 没建模`)
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }),
    }
    return chain as never
  })
}

const CONVO = 'convo-1'
const BASE = new Date('2026-01-01T00:00:00.000Z')

function iso(offsetMs: number): string {
  return new Date(BASE.getTime() + offsetMs).toISOString()
}

describe('classifyConversation', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  describe('售后关键词命中 → post_sale', () => {
    const cases: Array<{ label: string; body: string }> = [
      { label: 'booking（英文询问已下的订单）', body: 'Hi, I have a question about my booking for the Auckland tour' },
      { label: '我订的（中文，问已订行程细节）', body: '请问我订的那个团几点集合？' },
      { label: '我已付（中文，确认付款）', body: '我已付了定金，什么时候能收到确认单' },
      { label: 'receipt（英文，要收据）', body: 'Could you please send me the receipt for my payment?' },
      { label: '我下单了（中文，确认已下单）', body: '我下单了，但还没收到邮件通知' },
    ]

    for (const { label, body } of cases) {
      it(label, async () => {
        stubMessages([{ body, sent_at: iso(0) }])
        await expect(classifyConversation(CONVO)).resolves.toBe('post_sale')
      })
    }

    it('关键词大小写不敏感（BOOKING 全大写也要认）', async () => {
      stubMessages([{ body: 'Question about my BOOKING reference', sent_at: iso(0) }])
      await expect(classifyConversation(CONVO)).resolves.toBe('post_sale')
    })
  })

  describe('售前留资场景 → lead_intake', () => {
    const cases: Array<{ label: string; body: string }> = [
      { label: '英文询价（还没下单）', body: 'Hi, how much is the 10-day South Island tour?' },
      { label: '中文询价', body: '你好，请问新西兰6日游多少钱一个人？' },
      { label: '问团期', body: 'Do you have any tours available in December?' },
      { label: '留联系方式', body: 'My name is Jordan, phone 021 555 0134, please call me back' },
      { label: '泛泛咨询', body: '想了解一下你们的旅游团，有哪些行程可以选' },
    ]

    for (const { label, body } of cases) {
      it(label, async () => {
        stubMessages([{ body, sent_at: iso(0) }])
        await expect(classifyConversation(CONVO)).resolves.toBe('lead_intake')
      })
    }
  })

  describe('对话跨度边界（issue 要求的两个边界值）', () => {
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

    it('恰好 30 天 → 不算 post_sale（严格大于才算）', async () => {
      stubMessages([
        { body: '你好，请问有没有团期', sent_at: iso(0) },
        { body: '好的，谢谢', sent_at: iso(THIRTY_DAYS_MS) },
      ])
      await expect(classifyConversation(CONVO)).resolves.toBe('lead_intake')
    })

    it('30 天零 1 秒 → post_sale', async () => {
      stubMessages([
        { body: '你好，请问有没有团期', sent_at: iso(0) },
        { body: '好的，谢谢', sent_at: iso(THIRTY_DAYS_MS + 1000) },
      ])
      await expect(classifyConversation(CONVO)).resolves.toBe('post_sale')
    })
  })

  it('没有消息（比如 conversationId 传错）→ 保守判 lead_intake', async () => {
    stubMessages([])
    await expect(classifyConversation(CONVO)).resolves.toBe('lead_intake')
  })

  it('查询报错要往上抛，不能吞掉当作"没有消息"', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'conversation_messages') throw new Error(`fake supabase: 表 '${table}' 没建模`)
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        range: async () => ({ data: null, error: { message: 'network down' } }),
      }
      return chain as never
    })
    await expect(classifyConversation(CONVO)).rejects.toThrow('network down')
  })

  describe('分页读取（Codex 复审 P2：单次查询不能依赖 PostgREST 默认行数上限）', () => {
    it('对话消息数超过一页（500 条），售后关键词出现在第 501 条也要能命中', async () => {
      const rows: Row[] = []
      for (let i = 0; i < 500; i++) {
        rows.push({ body: `第 ${i} 条闲聊消息`, sent_at: iso(i * 1000) })
      }
      // 第 501 条（下标 500，超过单页 500 条的边界）才带售后关键词。
      rows.push({ body: '我已付了尾款', sent_at: iso(500 * 1000) })

      stubMessages(rows)
      await expect(classifyConversation(CONVO)).resolves.toBe('post_sale')
    })

    it('对话消息数超过一页时，"最后一条消息"要是真正的最后一条，不是第一页的最后一条', async () => {
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
      const rows: Row[] = []
      for (let i = 0; i < 500; i++) {
        rows.push({ body: `第 ${i} 条闲聊消息`, sent_at: iso(i * 1000) })
      }
      // 真正的最后一条跨度超过 30 天，但如果分页没做全，第一页最后一条（下标 499）
      // 跨度远不到 30 天，会被误判成 lead_intake。
      rows.push({ body: '好的谢谢', sent_at: iso(THIRTY_DAYS_MS + 1000) })

      stubMessages(rows)
      await expect(classifyConversation(CONVO)).resolves.toBe('post_sale')
    })
  })

  describe('关键词/跨度可覆盖（Codex 复审 P1：默认值不是全平台硬编码）', () => {
    it('传入自定义关键词时，CTS 默认关键词不再生效，只认传入的那一份', async () => {
      stubMessages([{ body: '我已付了定金', sent_at: iso(0) }])
      // 自定义策略里没有"我已付"，CTS 默认值里有——验证真的切换成了传入的策略。
      await expect(
        classifyConversation(CONVO, { postSaleKeywords: ['appraisal booking'] }),
      ).resolves.toBe('lead_intake')
    })

    it('传入自定义关键词命中时判 post_sale', async () => {
      stubMessages([{ body: "I'd like an appraisal booking please", sent_at: iso(0) }])
      await expect(
        classifyConversation(CONVO, { postSaleKeywords: ['appraisal booking'] }),
      ).resolves.toBe('post_sale')
    })

    it('传入自定义跨度阈值时，按传入值判断，不是固定 30 天', async () => {
      const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
      stubMessages([
        { body: '你好', sent_at: iso(0) },
        { body: '谢谢', sent_at: iso(SEVEN_DAYS_MS + 1000) },
      ])
      // 默认 30 天阈值下这跨度判不了 post_sale；传入 7 天阈值应该判成 post_sale。
      await expect(classifyConversation(CONVO)).resolves.toBe('lead_intake')
      await expect(
        classifyConversation(CONVO, { postSaleSpanMs: SEVEN_DAYS_MS }),
      ).resolves.toBe('post_sale')
    })
  })
})
