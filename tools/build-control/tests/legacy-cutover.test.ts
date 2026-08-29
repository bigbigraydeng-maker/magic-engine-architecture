import { describe, expect, it } from 'vitest'
import { CUTOVER_ISO, applyCutoverGrading, isLegacyPr } from '../src/legacy-cutover.mjs'

describe('isLegacyPr', () => {
  it('is legacy strictly before the cutover', () => {
    expect(isLegacyPr('2026-08-12T00:00:00Z')).toBe(true)
  })

  it('is not legacy at or after the cutover', () => {
    expect(isLegacyPr(CUTOVER_ISO)).toBe(false)
    expect(isLegacyPr('2026-09-01T00:00:00Z')).toBe(false)
  })

  it('fails closed (treats as not-legacy) on an unparseable date', () => {
    expect(isLegacyPr('not-a-date')).toBe(false)
  })
})

describe('applyCutoverGrading', () => {
  it('passes outright when the checks would not have failed', () => {
    expect(applyCutoverGrading({ createdAt: '2026-08-01T00:00:00Z', wouldFail: false })).toBe('PASS')
  })

  // Fixture #5: legacy pre-cutover PRs pass with a truthful grandfather/triage result.
  it('grandfathers a legacy PR that would otherwise fail', () => {
    expect(applyCutoverGrading({ createdAt: '2026-08-01T00:00:00Z', wouldFail: true })).toBe('LEGACY_TRIAGE_REQUIRED')
  })

  it('fails outright a post-cutover PR that would fail', () => {
    expect(applyCutoverGrading({ createdAt: '2026-09-01T00:00:00Z', wouldFail: true })).toBe('FAIL')
  })
})
