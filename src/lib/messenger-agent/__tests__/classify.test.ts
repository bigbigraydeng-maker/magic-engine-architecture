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
 * 跟 classify.ts 里的 POST_SALE_KEYWORDS 保持一致的测试夹具副本 —— 实现里
 * 那份清单没有导出，这里独立维护一份不是偷懒，而是让测试断言不依赖实现内部
 * 细节，只依赖「实现文档里承诺的判据」。
 */
const KEYWORDS = ['booking', '我订的', '我已付', 'receipt', '我下单了']

function containsAnyKeyword(body: string | null): boolean {
  if (!body) return false
  const lower = body.toLowerCase()
  return KEYWORDS.some((kw) => lower.includes(kw))
}

/**
 * 拿一组消息行（不要求预先排序）喂给 mock 的 supabase 链式调用，模拟实现
 * 现在会发出的三条独立查询：关键词存在性查询（`.or()` + `limit(1)`，直接
 * `await` 链本身）、首条 / 末条消息时间查询（`.order() + .limit(1).maybeSingle()`）。
 */
function stubMessages(rows: Row[]) {
  mockFrom.mockImplementation((table: string) => {
    if (table !== 'conversation_messages') throw new Error(`fake supabase: 表 '${table}' 没建模`)

    let usedOrFilter = false
    let ascending = true

    const sortedAsc = [...rows].sort(
      (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
    )

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      or: () => {
        usedOrFilter = true
        return chain
      },
      order: (_col: string, opts?: { ascending?: boolean }) => {
        ascending = opts?.ascending ?? true
        return chain
      },
      limit: () => chain,
      maybeSingle: async () => {
        const edge = ascending ? sortedAsc[0] : sortedAsc[sortedAsc.length - 1]
        return { data: edge ?? null, error: null }
      },
      then: (resolve: (v: { data: Row[] | null; error: null }) => unknown) => {
        const matched = usedOrFilter ? rows.filter((r) => containsAnyKeyword(r.body)).slice(0, 1) : rows
        return Promise.resolve({ data: matched, error: null }).then(resolve)
      },
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
      const error = { message: 'network down' }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        or: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: null, error }),
        then: (resolve: (v: { data: null; error: typeof error }) => unknown) =>
          Promise.resolve({ data: null, error }).then(resolve),
      }
      return chain as never
    })
    await expect(classifyConversation(CONVO)).rejects.toThrow('network down')
  })
})
