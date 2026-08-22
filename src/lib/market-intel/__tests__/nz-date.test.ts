import { describe, it, expect } from 'vitest'
import { nzDateString } from '../nz-date'

describe('nzDateString', () => {
  it('converts a UTC evening timestamp to the following NZ calendar day', () => {
    // 18:00 UTC ≈ 06:00 NZST（cron 实际排期时间）——UTC 当天傍晚，NZ 已经是次日清晨。
    const utc = new Date('2026-08-19T18:00:00.000Z')
    expect(nzDateString(utc)).toBe('2026-08-20')
  })

  it('converts a UTC midnight timestamp within the same NZ calendar day', () => {
    // NZDT（夏令时）期间 UTC+13，00:00 UTC 已经是 NZ 当天 13:00，同一天。
    const utc = new Date('2026-01-15T00:00:00.000Z')
    expect(nzDateString(utc)).toBe('2026-01-15')
  })
})
