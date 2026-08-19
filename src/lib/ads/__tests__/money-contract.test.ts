import { describe, it, expect } from 'vitest'
import { lockV1SandboxMoney, V1_SANDBOX_NZD_TO_USD_RATE, V1_SANDBOX_RATE_SOURCE } from '../money-contract'

describe('lockV1SandboxMoney — Money Contract 必须保留的 5 项信息', () => {
  it('返回完整记录：汇率/来源/锁定时间/NZD 金额/USD 金额都在', () => {
    const now = new Date('2026-08-20T09:00:00.000Z')
    const m = lockV1SandboxMoney(100, now)
    expect(m.amountNzd).toBe(100)
    expect(m.rate).toBe(V1_SANDBOX_NZD_TO_USD_RATE)
    expect(m.rateSource).toBe(V1_SANDBOX_RATE_SOURCE)
    expect(m.lockedAt).toBe('2026-08-20T09:00:00.000Z')
    expect(m.amountUsd).toBeGreaterThan(0)
  })

  it('rateSource 不是空字符串或裸常量名 —— 必须是人话说明（PO 口径）', () => {
    const m = lockV1SandboxMoney(20)
    expect(m.rateSource.length).toBeGreaterThan(20)
    expect(m.rateSource).toContain('PM')
  })

  it('100 NZD @ 0.60 → 60 USD（整数边界不因舍入多算）', () => {
    const m = lockV1SandboxMoney(100, new Date())
    expect(m.amountUsd).toBe(60)
  })

  it('20 NZD @ 0.60 → 12 USD', () => {
    const m = lockV1SandboxMoney(20, new Date())
    expect(m.amountUsd).toBe(12)
  })

  it('向上舍入到分 —— 不能让 USD 上限比实际换算值更宽松', () => {
    // 33 NZD * 0.60 = 19.8 精确值；不应该被向下舍成 19.79 之类
    const m = lockV1SandboxMoney(33, new Date())
    expect(m.amountUsd).toBeGreaterThanOrEqual(33 * V1_SANDBOX_NZD_TO_USD_RATE)
  })

  it('0 是合法输入（还没花过钱的起点）', () => {
    const m = lockV1SandboxMoney(0, new Date())
    expect(m.amountNzd).toBe(0)
    expect(m.amountUsd).toBe(0)
  })

  it('负数金额 → 拒绝', () => {
    expect(() => lockV1SandboxMoney(-1)).toThrow()
  })

  it('NaN → 拒绝', () => {
    expect(() => lockV1SandboxMoney(NaN)).toThrow()
  })

  it('不传 now 就用当前时间（不炸，产出合法 ISO 字符串）', () => {
    const m = lockV1SandboxMoney(10)
    expect(() => new Date(m.lockedAt).toISOString()).not.toThrow()
  })
})
