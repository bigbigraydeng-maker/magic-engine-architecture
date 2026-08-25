import { describe, it, expect } from 'vitest'
import * as ts from 'typescript'
import { mapPayloadToCtsTourFields } from './publisher'
import { serializeTourObject } from './tour-object-writer'
import { EMPTY_GROUP_TOUR_PAYLOAD, type GroupTourPayload } from './types'

describe('mapPayloadToCtsTourFields —— departures 派生一致性', () => {
  it('departureDates 和 departurePricing 的 key 100% 来自同一份 departures[]，不会分叉', () => {
    const payload: GroupTourPayload = {
      ...EMPTY_GROUP_TOUR_PAYLOAD,
      destination: 'china',
      title: 'Test Tour',
      duration: '10 Days',
      price: 'From NZD $2,999',
      departures: [
        { date: '3 November 2026', price: 'NZD $3,880' },
        { date: '11 March 2027', price: null }, // 无专属价，不进 departurePricing
      ],
    }
    const fields = mapPayloadToCtsTourFields(payload, 'test-tour')
    expect(fields.departureDates).toEqual(['3 November 2026', '11 March 2027'])
    expect(fields.departurePricing).toEqual({ '3 November 2026': 'NZD $3,880' })
    // 每个 departurePricing 的 key 必须能在 departureDates 里原样找到
    for (const key of Object.keys(fields.departurePricing as Record<string, string>)) {
      expect((fields.departureDates as string[]).includes(key)).toBe(true)
    }
  })

  it('没有团期时不产出 departureDates/departurePricing 字段', () => {
    const fields = mapPayloadToCtsTourFields({ ...EMPTY_GROUP_TOUR_PAYLOAD, departures: [] }, 'x')
    expect(fields.departureDates).toBeUndefined()
    expect(fields.departurePricing).toBeUndefined()
  })

  it('序列化结果对真实一批含撇号/引号的行程数据也必须是合法语法（端到端，不只是合成用例）', () => {
    const payload: GroupTourPayload = {
      ...EMPTY_GROUP_TOUR_PAYLOAD,
      destination: 'china',
      title: "Golden China — Xi'an & Beijing",
      duration: '13 Days',
      price: 'From NZD $4,999 per person',
      singleSupplement: 'NZD $690',
      departures: [{ date: '16 November 2026', price: null }],
      itinerary: [
        { day: 1, title: "Beijing — Xi'an", description: 'Visit Xi\'an\'s Terracotta Warriors; hotel is "4-star".', meals: ['Breakfast'], accommodation: "Mercure Downtown Xi'an" },
      ],
      highlights: ["Marvel at Xi'an's Terracotta Warriors"],
    }
    const fields = mapPayloadToCtsTourFields(payload, 'golden-china')
    const text = serializeTourObject(fields)
    const out = ts.transpileModule(`const x = ${text};`, { reportDiagnostics: true })
    const errors = (out.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error)
    expect(errors).toHaveLength(0)
  })
})
