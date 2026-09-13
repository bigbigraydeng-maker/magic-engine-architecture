/**
 * Pure-function tests for the mining pipeline. Real-message fixtures are the
 * same NAL (New Asian Logistics, client_id 4ae76381-cd45-43bd-85cd-98cfd7604007)
 * production messages already verified against the source database for
 * sensitivity.test.ts (2026-09-13, see that file's header for the query).
 */

import { describe, it, expect } from 'vitest'
import {
  assertMiningBudget,
  normaliseTemplateKey,
  groupMessagesIntoTemplates,
  redactPersonalInfo,
  validateNumberProvenance,
  classifyCandidateSpecificity,
  computeValueSignature,
  groupCandidatesByConflict,
  RawMessage,
  ConflictMember,
} from '../mining'

// ── REAL NAL messages (verbatim, see sensitivity.test.ts header for the query) ──
const REAL_MAIN_TEMPLATE =
  'Shipping rates\n' +
  '• Under 20 kg: NZD 4/kg\n' +
  '• 20 kg or more: NZD 2/kg\n' +
  'Service fees per shipment\n' +
  '• General goods: NZD 12\n' +
  '• Food products: NZD 24\n' +
  'Please note that food and general goods must be packed, shipped and charged separately.'

const REAL_MISTYPED_TEMPLATE =
  'Shipping rates\n' +
  '• Under 10 kg: NZD 4/kg\n' +
  '• 20 kg or more: NZD 2/kg\n' +
  'Service fees per shipment\n' +
  '• General goods: NZD 12\n' +
  '• Food products: NZD 24'

const REAL_138KG_QUOTE =
  'Based on the estimated chargeable weight of 138 kg, the total would be approximately:\n\n' +
  'Freight: 138 kg × NZD 4 = NZD 552\n' +
  'Service fee: NZD 12\n' +
  'Customs declaration fee: NZD 57.50\n' +
  'Rural delivery surcharge: NZD 35\n\n' +
  'Estimated total: NZD 656.50'

const REAL_CHINESE_ADDRESS_BLOCK =
  '收件地址：广东省广州市花都区花东镇北兴花侨花都大道东439号B栋一楼淘急集集运28967\n' +
  '收件人：TJJ28967 - Praash\n' +
  '电话：13682374589\n' +
  '邮编：510890'

const REAL_CUSTOMS_QUOTE = 'Custom fee about NZD 212\nGST is 15% of (product value + freight charge)'

// ── assertMiningBudget ───────────────────────────────────────────────────

describe('assertMiningBudget', () => {
  it('accepts a fully specified budget', () => {
    expect(() => assertMiningBudget({ maxMessages: 500, maxModelCalls: 20, maxSpendUsd: 5 })).not.toThrow()
  })

  it.each([
    ['missing entirely', undefined],
    ['null', null],
    ['missing maxMessages', { maxModelCalls: 20, maxSpendUsd: 5 }],
    ['zero maxMessages', { maxMessages: 0, maxModelCalls: 20, maxSpendUsd: 5 }],
    ['negative maxMessages', { maxMessages: -1, maxModelCalls: 20, maxSpendUsd: 5 }],
    ['missing maxModelCalls', { maxMessages: 500, maxSpendUsd: 5 }],
    ['zero maxModelCalls', { maxMessages: 500, maxModelCalls: 0, maxSpendUsd: 5 }],
    ['missing maxSpendUsd', { maxMessages: 500, maxModelCalls: 20 }],
    ['zero maxSpendUsd', { maxMessages: 500, maxModelCalls: 20, maxSpendUsd: 0 }],
  ] as const)('refuses to run when %s', (_label, budget) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => assertMiningBudget(budget as any)).toThrow()
  })
})

// ── template merging ─────────────────────────────────────────────────────

describe('normaliseTemplateKey', () => {
  it('collapses whitespace/newline noise but preserves every digit', () => {
    const a = normaliseTemplateKey('Under  20 kg:\nNZD 4/kg')
    const b = normaliseTemplateKey('Under 20 kg: NZD 4/kg')
    expect(a).toBe(b)
  })

  // Mutation guard: the 51-vs-28 real templates must never merge.
  it('does NOT merge the real "Under 20 kg" and "Under 10 kg" templates', () => {
    expect(normaliseTemplateKey(REAL_MAIN_TEMPLATE)).not.toBe(normaliseTemplateKey(REAL_MISTYPED_TEMPLATE))
  })
})

describe('groupMessagesIntoTemplates', () => {
  function outbound(body: string, sentAt: string, conversationId = 'c1'): RawMessage {
    return { body, sentAt, direction: 'outbound', conversationId }
  }
  function inbound(body: string, sentAt: string, conversationId = 'c1'): RawMessage {
    return { body, sentAt, direction: 'inbound', conversationId }
  }

  it('merges only exact-duplicate templates and counts occurrences (REAL template, 3 conversations)', () => {
    const messages: RawMessage[] = [
      outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:00:00Z', 'c1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:00:00Z', 'c2'),
      outbound(REAL_MISTYPED_TEMPLATE, '2026-01-03T00:00:00Z', 'c3'),
    ]
    const templates = groupMessagesIntoTemplates(messages)
    expect(templates).toHaveLength(2)
    const main = templates.find((t) => t.sampleBody === REAL_MAIN_TEMPLATE)
    const mistyped = templates.find((t) => t.sampleBody === REAL_MISTYPED_TEMPLATE)
    expect(main?.count).toBe(2)
    expect(mistyped?.count).toBe(1)
  })

  it('pairs each template with the immediately preceding customer question, per conversation', () => {
    const messages: RawMessage[] = [
      inbound('what is the price for 20kg?', '2026-01-01T00:00:00Z', 'c1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z', 'c1'),
    ]
    const templates = groupMessagesIntoTemplates(messages)
    expect(templates[0].precedingCustomerQuestion).toBe('what is the price for 20kg?')
  })

  it('leaves precedingCustomerQuestion null when the template opens the conversation', () => {
    const messages: RawMessage[] = [outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:00:00Z', 'c1')]
    expect(groupMessagesIntoTemplates(messages)[0].precedingCustomerQuestion).toBeNull()
  })

  it('ignores inbound messages as templates (never templatises what the customer said)', () => {
    const messages: RawMessage[] = [inbound('do you ship to Hamilton?', '2026-01-01T00:00:00Z', 'c1')]
    expect(groupMessagesIntoTemplates(messages)).toEqual([])
  })
})

// ── PII redaction (REAL NAL address/phone/tracking-number block) ─────────

describe('redactPersonalInfo', () => {
  it('redacts the real Chinese warehouse address block (address/phone/tracking number)', () => {
    const result = redactPersonalInfo(REAL_CHINESE_ADDRESS_BLOCK)
    expect(result.text).not.toContain('花都区')
    expect(result.text).not.toContain('13682374589')
    expect(result.text).not.toContain('510890')
    expect(result.hits).toEqual(expect.arrayContaining(['address', 'tracking_number', 'phone_or_postcode']))
  })

  it('redacts an email address', () => {
    const result = redactPersonalInfo('please email me at customer@example.com for details')
    expect(result.text).not.toContain('customer@example.com')
    expect(result.hits).toContain('email')
  })

  it('does NOT redact ordinary business numbers (price/weight/percentage)', () => {
    const result = redactPersonalInfo(REAL_MAIN_TEMPLATE)
    expect(result.text).toBe(REAL_MAIN_TEMPLATE)
    expect(result.hits).toEqual([])
  })

  it('does NOT redact the real 138kg quote — every number in it is a business figure, not PII', () => {
    const result = redactPersonalInfo(REAL_138KG_QUOTE)
    expect(result.text).toBe(REAL_138KG_QUOTE)
    expect(result.hits).toEqual([])
  })

  it('does NOT redact the real customs/GST quote', () => {
    const result = redactPersonalInfo(REAL_CUSTOMS_QUOTE)
    expect(result.text).toBe(REAL_CUSTOMS_QUOTE)
    expect(result.hits).toEqual([])
  })
})

// ── number provenance ────────────────────────────────────────────────────

describe('validateNumberProvenance', () => {
  it('passes when every candidate number appears in the real source message (138kg case)', () => {
    expect(
      validateNumberProvenance(
        'Freight for 138 kg is NZD 552, service fee NZD 12',
        { chargeable_weight_kg: 138, freight: 552 },
        REAL_138KG_QUOTE,
      ),
    ).toBe(true)
  })

  it('fails when the candidate invents a number absent from the source (hallucination guard)', () => {
    expect(validateNumberProvenance('Freight is NZD 700', null, REAL_138KG_QUOTE)).toBe(false)
  })

  it('passes trivially for a candidate with no numbers at all', () => {
    expect(validateNumberProvenance('We reply during business hours', null, REAL_MAIN_TEMPLATE)).toBe(true)
  })

  it('does not falsely reject the real main template quoting its own numbers', () => {
    expect(
      validateNumberProvenance(
        'Under 20 kg: NZD 4/kg, 20kg or more: NZD 2/kg, service fee NZD 12/NZD 24',
        { under_kg: 20, rate: 4, service_fee_general: 12, service_fee_food: 24 },
        REAL_MAIN_TEMPLATE,
      ),
    ).toBe(true)
  })
})

// ── deal-specific classification ─────────────────────────────────────────

describe('classifyCandidateSpecificity', () => {
  it('is deal_specific when the model gives no verdict at all (fail-closed default)', () => {
    expect(
      classifyCandidateSpecificity({
        occurrenceCount: 51,
        modelSaysDealSpecific: undefined,
        numbersMatchCustomerQuestion: false,
      }),
    ).toBe('deal_specific')
    expect(
      classifyCandidateSpecificity({
        occurrenceCount: 51,
        modelSaysDealSpecific: null,
        numbersMatchCustomerQuestion: false,
      }),
    ).toBe('deal_specific')
  })

  it('is deal_specific when the model explicitly says so, even for a high-occurrence template', () => {
    expect(
      classifyCandidateSpecificity({
        occurrenceCount: 51,
        modelSaysDealSpecific: true,
        numbersMatchCustomerQuestion: false,
      }),
    ).toBe('deal_specific')
  })

  // Mutation guard: the real 138kg quote occurred exactly once — must never
  // become a reusable candidate no matter what the model says.
  it('is deal_specific when the template only occurred once, even if the model says otherwise', () => {
    expect(
      classifyCandidateSpecificity({
        occurrenceCount: 1,
        modelSaysDealSpecific: false,
        numbersMatchCustomerQuestion: false,
      }),
    ).toBe('deal_specific')
  })

  it('is suspected_deal_specific when a repeated template happens to echo the customer’s own numbers', () => {
    expect(
      classifyCandidateSpecificity({
        occurrenceCount: 51,
        modelSaysDealSpecific: false,
        numbersMatchCustomerQuestion: true,
      }),
    ).toBe('suspected_deal_specific')
  })

  it('is a reusable template when it recurs, the model approves, and numbers do not echo the customer', () => {
    expect(
      classifyCandidateSpecificity({
        occurrenceCount: 51,
        modelSaysDealSpecific: false,
        numbersMatchCustomerQuestion: false,
      }),
    ).toBe('template')
  })
})

// ── conflict grouping ────────────────────────────────────────────────────

describe('computeValueSignature', () => {
  it('is order-independent for object keys and ignores the unit field', () => {
    const a = computeValueSignature({ unit: 'NZD/kg', under_kg: 20, rate: 4 })
    const b = computeValueSignature({ rate: 4, under_kg: 20, unit: 'NZD/kg different but ignored' })
    expect(a).toBe(b)
  })

  it('differs when the actual value differs', () => {
    expect(computeValueSignature({ under_kg: 20, rate: 4 })).not.toBe(computeValueSignature({ under_kg: 20, rate: 7 }))
  })
})

describe('groupCandidatesByConflict', () => {
  function member(overrides: Partial<ConflictMember>): ConflictMember {
    return {
      origin: 'candidate',
      refId: '0',
      factKey: 'rate.parcel.per_kg',
      unit: 'NZD/kg',
      valueSignature: 'v1',
      ...overrides,
    }
  }

  it('groups the real 51x and 4x/2x variants under the same unit, unconditionally', () => {
    // REAL: "Under 20kg: NZD4/kg" (51x) vs "Under 20kg: NZD7/kg" (4x) vs
    // "Under 20kg: NZD6/kg" (2x) — three genuinely different asserted rates,
    // same fact_key, same unit.
    const groups = groupCandidatesByConflict([
      member({ refId: '0', valueSignature: 'rate=4' }),
      member({ refId: '1', valueSignature: 'rate=7' }),
      member({ refId: '2', valueSignature: 'rate=6' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].hasConflict).toBe(true)
    expect(groups[0].members).toHaveLength(3)
  })

  it('does not flag a group as conflicting when every member asserts the same value (corroboration, not conflict)', () => {
    const groups = groupCandidatesByConflict([
      member({ refId: '0', valueSignature: 'rate=4' }),
      member({ refId: '1', valueSignature: 'rate=4' }),
    ])
    expect(groups[0].hasConflict).toBe(false)
  })

  it('keeps different units in separate groups even under the same fact_key', () => {
    const groups = groupCandidatesByConflict([
      member({ refId: '0', unit: 'NZD/kg', valueSignature: 'rate=4' }),
      member({ refId: '1', unit: 'NZD/CBM', valueSignature: 'rate=200' }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.every((g) => !g.hasConflict)).toBe(true)
  })

  it('groups a fresh candidate against an already-approved fact of the same unit (not just candidate-vs-candidate)', () => {
    const groups = groupCandidatesByConflict([
      member({ origin: 'approved', refId: 'fact-1', valueSignature: 'rate=4' }),
      member({ origin: 'candidate', refId: '0', valueSignature: 'rate=9' }),
    ])
    expect(groups[0].hasConflict).toBe(true)
    expect(groups[0].members.map((m) => m.origin).sort()).toEqual(['approved', 'candidate'])
  })
})
