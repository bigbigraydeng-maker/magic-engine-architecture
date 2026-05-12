/**
 * P9.0.13 — edge-cases.test.ts
 * Pure-function boundary scenarios for progress-utils.
 * No mocks — imports real implementations.
 */

import {
  getProgressPercent,
  formatCountdown,
  shouldEnableCancelButton,
} from '../progress-utils'

describe('getProgressPercent — edge cases', () => {
  it('getProgressPercent(0, 0) returns 0 (no divide-by-zero crash)', () => {
    expect(getProgressPercent(0, 0)).toBe(0)
  })

  it('getProgressPercent(-100, 1000) returns 0 (negative elapsed)', () => {
    expect(getProgressPercent(-100, 1000)).toBe(0)
  })
})

describe('formatCountdown — edge cases', () => {
  it('formatCountdown(0) returns "0s"', () => {
    expect(formatCountdown(0)).toBe('0s')
  })
})

describe('shouldEnableCancelButton — edge cases', () => {
  it('shouldEnableCancelButton(0, 0) returns false (expectedMs=0 conservative guard)', () => {
    expect(shouldEnableCancelButton(0, 0)).toBe(false)
  })
})
