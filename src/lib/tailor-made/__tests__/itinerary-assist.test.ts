/**
 * 「一句话改行程单」。
 *
 * 行程单比画册凶险：里面有酒店名、车次、餐食、价格 —— 客人拿着它去值机、去入住。
 * 所以这里最要紧的一条不是「模型会不会乱写」，而是**它根本改不动那些字段**：
 * 它们不在可改清单里，模型点名也没用。靠 prompt 叮嘱不算数。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()

vi.mock('@/lib/anthropic/client', async (actual) => ({
  ...(await actual<typeof import('@/lib/anthropic/client')>()),
  getAnthropicClient: () => ({ messages: { create: mockCreate } }),
}))

import { assistItinerary, listFields } from '../itinerary-assist'
import { createBlankItinerary, type TailorMadeItinerary } from '../types'

function sample(): TailorMadeItinerary {
  const it = createBlankItinerary('CTS-2026-0026')
  it.trip.title = '50 & Fabulous'
  it.trip.summary = 'A family journey through China.'
  it.trip.highlights = ['Great Wall', 'Terracotta Warriors']
  it.days = [
    {
      day: 1, date: '2 Nov', weekday: 'Monday', route: 'Arrive Beijing',
      body: 'Arrive and visit the Temple of Heaven.',
      accommodation: 'Wanda Moment Hotel or similar 4*',
      travel: 'High-speed train · Beijing → Xi\'an',
      meals: 'Breakfast',
    },
    {
      day: 2, date: '3 Nov', weekday: 'Tuesday', route: 'Beijing',
      body: 'The Great Wall at Mutianyu.',
      accommodation: 'Wanda Moment Hotel or similar 4*',
      meals: 'Breakfast',
    },
  ]
  it.pricing.amount = 4988
  return it
}

function reply(payload: unknown, stop_reason = 'end_turn') {
  return { stop_reason, content: [{ type: 'text', text: JSON.stringify(payload) }] }
}

beforeEach(() => mockCreate.mockReset())

describe('listFields', () => {
  it('只列散文字段', () => {
    const ids = listFields(sample()).map((f) => f.id)
    expect(ids).toContain('trip.summary')
    expect(ids).toContain('day.0.body')
    expect(ids).toContain('trip.highlight.0')
  })

  /**
   * 这条是整个功能的安全底线：酒店、餐食、车次、价格根本不进清单，
   * 模型看都看不到，自然也改不动。
   */
  it('酒店 / 餐食 / 车次 / 价格一律不进可改清单', () => {
    const ids = listFields(sample()).map((f) => f.id).join(' ')
    for (const forbidden of ['accommodation', 'meals', 'travel', 'pricing', 'amount', 'flight']) {
      expect(ids).not.toContain(forbidden)
    }
  })

  it('每天的标签带上路线，模型才知道「西安那两天」是哪几条', () => {
    const label = listFields(sample()).find((f) => f.id === 'day.0.body')?.label
    expect(label).toContain('Arrive Beijing')
  })
})

describe('assistItinerary', () => {
  it('只改点名的字段，其余原样保留', async () => {
    const before = sample()
    mockCreate.mockResolvedValue(
      reply({ edits: [{ id: 'day.1.body', value: 'A longer Great Wall description.' }], note: '已改第 2 天' })
    )

    const { payload: after, changed } = await assistItinerary({ payload: before, instruction: '第 2 天写长一点' })

    expect(after.days[1].body).toBe('A longer Great Wall description.')
    expect(after.days[0]).toEqual(before.days[0])
    expect(after.trip.summary).toBe(before.trip.summary)
    expect(changed).toHaveLength(1)
  })

  /**
   * 模型点名要改酒店 —— 必须无效。
   * 这不是「模型不会这么干」，是「它这么干了也改不动」。
   */
  it('模型点名改酒店、餐食、价格时一律无效', async () => {
    const before = sample()
    mockCreate.mockResolvedValue(
      reply({
        edits: [
          { id: 'day.0.accommodation', value: 'Four Seasons Beijing' },
          { id: 'day.0.meals', value: 'Breakfast, lunch and dinner' },
          { id: 'day.0.travel', value: 'Private car transfer' },
          { id: 'pricing.amount', value: '3999' },
          { id: 'day.0.body', value: 'ok' },
        ],
        note: 'n',
      })
    )

    const { payload: after, changed } = await assistItinerary({ payload: before, instruction: '改' })

    expect(changed).toHaveLength(1)
    expect(after.days[0].body).toBe('ok')
    expect(after.days[0].accommodation).toBe('Wanda Moment Hotel or similar 4*')
    expect(after.days[0].meals).toBe('Breakfast')
    expect(after.days[0].travel).toBe("High-speed train · Beijing → Xi'an")
    expect(after.pricing.amount).toBe(4988)
  })

  it('丢掉编出来的 id 和越界的下标', async () => {
    const before = sample()
    mockCreate.mockResolvedValue(
      reply({
        edits: [
          { id: 'day.99.body', value: '不存在的一天' },
          { id: '__proto__.polluted', value: 'x' },
          { id: 'trip.highlight.99', value: '越界' },
          { id: 'trip.summary', value: 'ok' },
        ],
        note: 'n',
      })
    )

    const { payload: after, changed } = await assistItinerary({ payload: before, instruction: '改' })

    expect(changed).toHaveLength(1)
    expect(after.trip.summary).toBe('ok')
    expect(after.days).toHaveLength(2)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('被 max_tokens 截断时报错，不半改半留', async () => {
    mockCreate.mockResolvedValue(
      reply({ edits: [{ id: 'day.0.body', value: 'only half the work' }] }, 'max_tokens')
    )
    await expect(assistItinerary({ payload: sample(), instruction: '全部重写' })).rejects.toThrow(/太多|分两次/)
  })

  it('一条都没改成时如实返回说明，不当成错误抛出去', async () => {
    mockCreate.mockResolvedValue(reply({ edits: [], note: '酒店我不能改' }))
    const before = sample()
    const out = await assistItinerary({ payload: before, instruction: '把酒店换成四季' })
    expect(out.changed).toEqual([])
    expect(out.note).toContain('酒店')
    expect(out.payload).toEqual(before)
  })

  it('空指令直接挡掉，不浪费一次调用', async () => {
    await expect(assistItinerary({ payload: sample(), instruction: '  ' })).rejects.toThrow()
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
