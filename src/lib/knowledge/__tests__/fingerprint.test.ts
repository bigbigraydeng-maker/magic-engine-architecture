import { describe, it, expect } from 'vitest'
import { computeFactFingerprint, isConfirmationCurrent, FingerprintableFact } from '../fingerprint'

const BASE: FingerprintableFact = {
  statement: 'Under 20 kg: NZD 4/kg',
  structuredValue: { under_kg: 20, rate: 4, currency: 'NZD' },
  scope: { service_line: 'parcel_sea' },
  validUntil: '2026-12-31T00:00:00Z',
  visibility: 'customer_ok',
  sensitivity: 'price',
}

describe('computeFactFingerprint', () => {
  it('is deterministic for identical input', () => {
    expect(computeFactFingerprint(BASE)).toBe(computeFactFingerprint({ ...BASE }))
  })

  it('is order-independent for the structuredValue/scope object key order', () => {
    const reordered: FingerprintableFact = {
      ...BASE,
      structuredValue: { currency: 'NZD', rate: 4, under_kg: 20 },
      scope: { service_line: 'parcel_sea' },
    }
    expect(computeFactFingerprint(BASE)).toBe(computeFactFingerprint(reordered))
  })

  // Mutation guard: §9.14-D item 3 — every field that participates in a
  // customer's confirmation must independently change the fingerprint.
  it.each([
    ['statement', { statement: 'Under 20 kg: NZD 5/kg' }],
    ['structuredValue', { structuredValue: { under_kg: 20, rate: 5, currency: 'NZD' } }],
    ['scope', { scope: { service_line: 'parcel_air' } }],
    ['validUntil', { validUntil: '2027-01-01T00:00:00Z' }],
    ['visibility', { visibility: 'internal_only' }],
    ['sensitivity', { sensitivity: 'timeline' }],
  ] as const)('changing %s changes the fingerprint', (_label, patch) => {
    const changed: FingerprintableFact = { ...BASE, ...patch } as FingerprintableFact
    expect(computeFactFingerprint(changed)).not.toBe(computeFactFingerprint(BASE))
  })

  it('treats a null validUntil differently from a set one', () => {
    expect(computeFactFingerprint({ ...BASE, validUntil: null })).not.toBe(computeFactFingerprint(BASE))
  })
})

describe('isConfirmationCurrent', () => {
  it('is true when the stored fingerprint matches the fact as it is now', () => {
    const fp = computeFactFingerprint(BASE)
    expect(isConfirmationCurrent(BASE, fp)).toBe(true)
  })

  it('is false when the fact changed after confirmation (stale fingerprint)', () => {
    const fp = computeFactFingerprint(BASE)
    const edited = { ...BASE, statement: 'Under 20 kg: NZD 6/kg' }
    expect(isConfirmationCurrent(edited, fp)).toBe(false)
  })

  it('is false when there is no stored confirmation at all', () => {
    expect(isConfirmationCurrent(BASE, null)).toBe(false)
    expect(isConfirmationCurrent(BASE, undefined)).toBe(false)
    expect(isConfirmationCurrent(BASE, '')).toBe(false)
  })
})
