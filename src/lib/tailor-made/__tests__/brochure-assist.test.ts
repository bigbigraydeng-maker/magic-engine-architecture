/**
 * 「一句话改画册」。
 *
 * 这里盯的不是「改得好不好」（那是模型的事），而是三件不能出的事：
 *  1. 没被点名的内容必须原样保留 —— 画册十几页，顾问不会逐页核对；
 *  2. 模型编的字段路径不能生效 —— 那等于让模型任意写内存；
 *  3. 被 max_tokens 截断的半份修改必须报错，不能悄悄用掉。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()

vi.mock('@/lib/anthropic/client', async (actual) => ({
  ...(await actual<typeof import('@/lib/anthropic/client')>()),
  getAnthropicClient: () => ({ messages: { create: mockCreate } }),
}))

import { assistBrochure, listFields } from '../brochure-assist'
import { createBrochureFromItinerary } from '../brochure-seed'
import { createBlankItinerary } from '../types'

function sample() {
  const it = createBlankItinerary('CTS-2026-0010')
  it.trip.title = 'China Icons Collection'
  it.trip.route = ['Beijing', 'Shanghai']
  it.days = [
    { day: 1, date: '', weekday: '', route: 'Beijing', body: 'The Great Wall at Mutianyu.' },
    { day: 2, date: '', weekday: '', route: 'Beijing', body: 'The Forbidden City.' },
    { day: 3, date: '', weekday: '', route: 'Shanghai', body: 'The Bund after dark.' },
  ]
  return createBrochureFromItinerary(it)
}

function reply(payload: unknown, stop_reason = 'end_turn') {
  return { stop_reason, content: [{ type: 'text', text: JSON.stringify(payload) }] }
}

beforeEach(() => mockCreate.mockReset())

describe('listFields', () => {
  it('把每个可改字段都列出来，模型才知道能动什么', () => {
    const ids = listFields(sample()).map((f) => f.id)
    expect(ids).toContain('overview.intro')
    expect(ids).toContain('city.0.hero.body')
    expect(ids).toContain('city.0.block.0.body')
    expect(ids).toContain('city.1.hero.title')
  })
})

describe('assistBrochure', () => {
  it('只改点名的字段，其余原样保留', async () => {
    const before = sample()
    mockCreate.mockResolvedValue(
      reply({ edits: [{ id: 'city.0.hero.body', value: 'A longer Beijing description.' }], note: '已改北京' })
    )

    const { brochure: after, changed } = await assistBrochure({ brochure: before, instruction: '北京写长一点' })

    expect(after.cities[0].hero.body).toBe('A longer Beijing description.')
    // 其余一个字都不能动
    expect(after.cities[1]).toEqual(before.cities[1])
    expect(after.cover).toEqual(before.cover)
    expect(after.cities[0].blocks).toEqual(before.cities[0].blocks)
    expect(changed).toHaveLength(1)
  })

  it('丢掉模型编出来的字段路径', async () => {
    const before = sample()
    mockCreate.mockResolvedValue(
      reply({
        edits: [
          { id: 'city.99.hero.body', value: '不存在的城市' },
          { id: '__proto__.polluted', value: 'x' },
          { id: 'cover.image', value: 'https://evil.example/x.jpg' },
          { id: 'city.0.hero.body', value: 'ok' },
        ],
        note: 'n',
      })
    )

    const { brochure: after, changed } = await assistBrochure({ brochure: before, instruction: '改' })

    expect(changed).toHaveLength(1)
    expect(after.cities[0].hero.body).toBe('ok')
    // 图片字段不在可改清单里，模型点名也不生效
    expect(after.cover.image).toBe(before.cover.image)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('被 max_tokens 截断时报错，不半改半留', async () => {
    mockCreate.mockResolvedValue(
      reply({ edits: [{ id: 'city.0.hero.body', value: 'only half of the work' }] }, 'max_tokens')
    )
    await expect(assistBrochure({ brochure: sample(), instruction: '全部重写' })).rejects.toThrow(/太多|分两次/)
  })

  it('一条都没改成时报错，不假装成功', async () => {
    mockCreate.mockResolvedValue(reply({ edits: [], note: '价格类内容我不能写' }))
    await expect(assistBrochure({ brochure: sample(), instruction: '把价格写进去' })).rejects.toThrow(/价格/)
  })

  it('空指令直接挡掉，不浪费一次调用', async () => {
    await expect(assistBrochure({ brochure: sample(), instruction: '   ' })).rejects.toThrow()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('模型回复里裹了 markdown 围栏也能读', async () => {
    mockCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{
        type: 'text',
        text: '```json\n{"edits":[{"id":"overview.intro","value":"Fenced."}],"note":"ok"}\n```',
      }],
    })
    const { brochure } = await assistBrochure({ brochure: sample(), instruction: '改开篇' })
    expect(brochure.overview.intro).toBe('Fenced.')
  })
})
