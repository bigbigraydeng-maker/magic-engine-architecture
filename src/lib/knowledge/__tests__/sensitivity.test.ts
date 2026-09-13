/**
 * Sensitivity classifier tests.
 *
 * Real-data fixtures queried 2026-09-13 from production Supabase, client
 * NAL / New Asian Logistics (`client_id = 4ae76381-cd45-43bd-85cd-98cfd7604007`),
 * via the PostgREST equivalent of:
 *
 *   select cm.body, count(*) as n
 *   from conversation_messages cm
 *   join conversations c on c.id = cm.conversation_id
 *   where c.client_id = '4ae76381-cd45-43bd-85cd-98cfd7604007'
 *     and cm.direction = 'outbound'
 *   group by cm.body
 *   order by n desc;
 *
 * (181 conversations, 1107 outbound messages fetched.) Each fixture below is
 * marked REAL (verbatim from that query) or SCENARIO (written for this test,
 * modelled on NAL's real business but not itself a query result).
 */

import { describe, it, expect } from 'vitest'
import { containsSensitiveSignal, resolveFactSensitivity, FactSensitivity } from '../sensitivity'

describe('containsSensitiveSignal — real NAL outbound messages', () => {
  it('flags the main price template (REAL, sent 51 times)', () => {
    const text =
      'Shipping rates\n' +
      '• Under 20 kg: NZD 4/kg\n' +
      '• 20 kg or more: NZD 2/kg\n' +
      'Service fees per shipment\n' +
      '• General goods: NZD 12\n' +
      '• Food products: NZD 24\n' +
      'Please note that food and general goods must be packed, shipped and charged separately.'
    expect(containsSensitiveSignal(text)).toBe(true)
  })

  it('flags the miswritten "Under 10 kg" template (REAL, sent 28 times — a distinct fact from the 20kg one)', () => {
    const text =
      'Shipping rates\n' +
      '• Under 10 kg: NZD 4/kg\n' +
      '• 20 kg or more: NZD 2/kg\n' +
      'Service fees per shipment\n' +
      '• General goods: NZD 12\n' +
      '• Food products: NZD 24'
    expect(containsSensitiveSignal(text)).toBe(true)
  })

  it('flags the Chinese-language version of the same price fact (REAL)', () => {
    const text =
      '运费：20公斤以下 NZD 4/公斤，20公斤以上 NZD 2/公斤。服务费：普通货 NZD 12 / 食品类 NZD 24' +
      '（食品与普通货需分开包装、分开计费）。货值超过 NZD 400 需缴清关申报费；超过 NZD 1000 可能需缴新西兰进口关税；' +
      '偏远地址额外收 NZD 35。如需精确报价，请告知总重量/体积和收货地址，或留下电话/微信，我们会尽快为你核算。'
    expect(containsSensitiveSignal(text)).toBe(true)
  })

  it('flags a deal-specific quote with a customs/GST breakdown (REAL, "Custom fee about NZD 212")', () => {
    expect(
      containsSensitiveSignal('Custom fee about NZD 212\nGST is 15% of (product value + freight charge)'),
    ).toBe(true)
  })

  it('flags a fully worked individual quote (REAL, "138 kg" case)', () => {
    const text =
      'Based on the estimated chargeable weight of 138 kg, the total would be approximately:\n\n' +
      'Freight: 138 kg × NZD 4 = NZD 552\n' +
      'Service fee: NZD 12\n' +
      'Customs declaration fee: NZD 57.50\n' +
      'Rural delivery surcharge: NZD 35\n\n' +
      'Estimated total: NZD 656.50'
    expect(containsSensitiveSignal(text)).toBe(true)
  })

  it('flags the air-freight cutoff schedule with no price at all (REAL)', () => {
    const text =
      'For air freight, our schedule is as follows:\n\n' +
      '*Cut-off:** Friday at 6:00 PM\n' +
      '*Cargo delivered to warehouse:** Saturday\n' +
      '* Arrival in Auckland:** Monday at approximately 4:00 PM'
    // Contains both digits (6:00 PM) and the "Cut-off" keyword — belt and braces.
    expect(containsSensitiveSignal(text)).toBe(true)
  })

  it('flags a Mt Wellington self-pickup rate typed without spaces (REAL, "2nzd/kg")', () => {
    expect(containsSensitiveSignal('你好 在Mt Wellington自提，2nzd/kg')).toBe(true)
  })

  it('does NOT flag a pure clarifying question with no number and no promise (REAL)', () => {
    expect(containsSensitiveSignal('Could you please let us know what type of goods you’re shipping?')).toBe(
      false,
    )
  })

  it('does NOT flag a pure Chinese clarifying question (REAL)', () => {
    expect(containsSensitiveSignal('请问需要邮寄什么？收货地址在哪里？')).toBe(false)
  })

  it('does NOT flag a routine greeting (REAL, "Hi! What can I do for you？")', () => {
    expect(containsSensitiveSignal('，Hi! What can I do for you？')).toBe(false)
  })
})

describe('containsSensitiveSignal — SCENARIO fixtures (constructed for this test, not query results)', () => {
  it('flags a Chinese weight-based rate phrased with 十/两 style numerals mixed with digits', () => {
    // SCENARIO: NAL-style phrasing using a Chinese magnitude word alongside a digit.
    expect(containsSensitiveSignal('两件包裹合计20公斤以下，每公斤4纽币')).toBe(true)
  })

  it('flags a pure-Chinese-numeral duration claim with no Arabic digit at all', () => {
    // SCENARIO: "cutoff is Friday at six" written with Chinese numerals only.
    expect(containsSensitiveSignal('周五下午六点截单')).toBe(true)
  })

  it('flags a guarantee/refund claim in English with zero digits', () => {
    // SCENARIO: no digit anywhere — only the deterministic keyword rule can catch this.
    expect(containsSensitiveSignal('We guarantee a refund if the parcel is lost.')).toBe(true)
  })

  it('flags a Chinese commitment claim ("保证"/"退款") with zero digits', () => {
    // SCENARIO
    expect(containsSensitiveSignal('包裹丢失我们保证退款')).toBe(true)
  })

  it('flags "包税" (duty included) with zero digits', () => {
    // SCENARIO
    expect(containsSensitiveSignal('这条线路包税包清关')).toBe(true)
  })

  it('does NOT flag a purely informational message with no number and no commitment word', () => {
    // SCENARIO
    expect(containsSensitiveSignal('Thanks for reaching out, our team will follow up shortly.')).toBe(false)
  })

  it('does NOT misjudge a slash-separated fee pair as a date and skip it (regression guard)', () => {
    // SCENARIO: guards against reusing comment-guardrails.ts's date regex, which
    // could plausibly read "12/24" as a numeric date and short-circuit before the
    // digit rule runs. This detector's digit rule fires unconditionally on any
    // digit, so "service fee: NZD 12 / NZD 24" must never slip through as general.
    expect(containsSensitiveSignal('Service fee: NZD 12 / NZD 24')).toBe(true)
  })
})

describe('resolveFactSensitivity', () => {
  it('trusts a recognised non-general tag as-is, even with no digits', () => {
    expect(resolveFactSensitivity('Our terms may change without notice.', 'policy')).toBe('policy')
  })

  it('overrides a "general" tag to "price" when the hard rule still fires (REAL price template, mistagged)', () => {
    expect(resolveFactSensitivity('Under 20 kg: NZD 4/kg', 'general')).toBe('price')
  })

  it('keeps "general" when the tag is general and the hard rule does not fire', () => {
    expect(resolveFactSensitivity('Thanks for your message, we will follow up.', 'general')).toBe('general')
  })

  it('defaults a missing tag to "price" — the strictest category, never "general"', () => {
    expect(resolveFactSensitivity('Thanks for your message, we will follow up.', undefined)).toBe('price')
    expect(resolveFactSensitivity('Thanks for your message, we will follow up.', null)).toBe('price')
  })

  it('defaults an unrecognised/unknown tag value to "price"', () => {
    expect(resolveFactSensitivity('Thanks for your message, we will follow up.', 'unknown-value')).toBe('price')
  })

  it('type-checks: the return value is always a valid FactSensitivity', () => {
    const value: FactSensitivity = resolveFactSensitivity('hello', 'timeline')
    expect(['price', 'timeline', 'commitment', 'policy', 'general']).toContain(value)
  })
})

describe('mutation guard — deleting the numeral rule must turn this red', () => {
  it('a digit with no keyword at all is still sensitive (isolates the numeral rule)', () => {
    // No currency word, no unit, no commitment keyword — only a bare digit.
    // If NUMERAL_PATTERN is removed from containsSensitiveSignal, this fails.
    expect(containsSensitiveSignal('4')).toBe(true)
    expect(containsSensitiveSignal('四')).toBe(true)
  })
})
