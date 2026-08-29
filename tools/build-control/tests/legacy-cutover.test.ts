import { describe, expect, it } from 'vitest'
import { CUTOVER_ISO, CUTOVER_MS, applyCutoverGrading, isLegacyPr } from '../src/legacy-cutover.mjs'

describe('the cutover instant', () => {
  // Rounding the cutover forward to the next midnight would grandfather every
  // PR opened between the contract existing and this code landing — exactly
  // the window a bypass would use.
  it('is the Issue #1249 contract creation instant, not a rounded midnight', () => {
    expect(CUTOVER_ISO).toBe('2026-08-29T13:03:37Z')
    expect(new Date(CUTOVER_MS).toISOString()).not.toMatch(/T00:00:00/)
  })

  it('is legacy strictly before the cutover', () => {
    expect(isLegacyPr('2026-08-12T00:00:00Z')).toBe(true)
    expect(isLegacyPr(new Date(CUTOVER_MS - 1))).toBe(true)
  })

  it('is not legacy at or after the cutover', () => {
    expect(isLegacyPr(CUTOVER_ISO)).toBe(false)
    expect(isLegacyPr('2026-08-29T23:59:59Z')).toBe(false)
  })

  it('fails closed (treats as not-legacy) on an unparseable date', () => {
    expect(isLegacyPr('not-a-date')).toBe(false)
  })
})

describe('applyCutoverGrading', () => {
  it('passes outright when the checks would not have failed', () => {
    expect(applyCutoverGrading({ createdAt: '2026-08-01T00:00:00Z', wouldFail: false })).toBe('PASS')
  })

  it('grandfathers a legacy PR that would otherwise fail', () => {
    expect(applyCutoverGrading({ createdAt: '2026-08-01T00:00:00Z', wouldFail: true })).toBe('LEGACY_TRIAGE_REQUIRED')
  })

  it('fails outright a post-cutover PR that would fail', () => {
    expect(applyCutoverGrading({ createdAt: '2026-09-01T00:00:00Z', wouldFail: true })).toBe('FAIL')
  })
})
