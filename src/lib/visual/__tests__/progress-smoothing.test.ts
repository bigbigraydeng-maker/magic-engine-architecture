/**
 * P9.0.11 — progress-smoothing.test.ts
 * Direct tests of shouldEnableCancelButton, formatCountdown, getProgressPercent
 * No mocks — imports real implementations.
 */

import {
  shouldEnableCancelButton,
  formatCountdown,
  getProgressPercent,
} from '../progress-utils'

describe('shouldEnableCancelButton', () => {
  it('returns false at 1.4x expected time', () => {
    expect(shouldEnableCancelButton(Math.floor(180000 * 1.4), 180000)).toBe(false)
  })

  it('returns true at exactly 1.5x expected time', () => {
    expect(shouldEnableCancelButton(180000 * 1.5, 180000)).toBe(true)
  })

  it('returns true at 2x expected time', () => {
    expect(shouldEnableCancelButton(180000 * 2, 180000)).toBe(true)
  })
})

describe('formatCountdown', () => {
  it('formatCountdown(0) returns "0s"', () => {
    expect(formatCountdown(0)).toBe('0s')
  })

  it('formatCountdown(61000) returns "1m 1s"', () => {
    expect(formatCountdown(61000)).toBe('1m 1s')
  })

  it('formatCountdown(125000) returns "2m 5s"', () => {
    expect(formatCountdown(125000)).toBe('2m 5s')
  })
})

describe('getProgressPercent', () => {
  it('getProgressPercent(0, 1000) returns 0', () => {
    expect(getProgressPercent(0, 1000)).toBe(0)
  })

  it('getProgressPercent(2000, 1000) is capped at 95', () => {
    expect(getProgressPercent(2000, 1000)).toBe(95)
  })

  it('getProgressPercent(500, 1000) returns 50', () => {
    expect(getProgressPercent(500, 1000)).toBe(50)
  })
})
