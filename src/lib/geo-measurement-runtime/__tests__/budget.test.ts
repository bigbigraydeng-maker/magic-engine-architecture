/**
 * 预算 preflight —— 授权第 4 条（Issue #874 / WP04）。
 * 说不出成本上界一律 fail closed；剩余不够一律不放行。
 */

import { describe, it, expect } from 'vitest'
import { preflightBudget, trustProviderCost } from '../budget'

describe('preflightBudget', () => {
  it('剩余充足 → 放行', () => {
    expect(preflightBudget(1, 0.5).allowed).toBe(true)
  })

  it('剩余恰好等于上界 → 放行（边界）', () => {
    expect(preflightBudget(0.5, 0.5).allowed).toBe(true)
  })

  it('剩余小于上界 → 拒', () => {
    const d = preflightBudget(0.3, 0.5)
    expect(d.allowed).toBe(false)
  })

  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -0.1]) {
    it(`下一步成本上界=${bad}（说不清）→ fail closed`, () => {
      expect(preflightBudget(100, bad).allowed).toBe(false)
    })
    it(`剩余=${bad}（说不清）→ fail closed`, () => {
      expect(preflightBudget(bad, 0.5).allowed).toBe(false)
    })
  }
})

describe('trustProviderCost', () => {
  const CEILING = 0.05

  it('上界内的正常金额 → 采信', () => {
    expect(trustProviderCost(0.01, CEILING)).toEqual({ trusted: true, costUsd: 0.01 })
  })

  it('恰好等于上界 → 采信（边界不误杀）', () => {
    expect(trustProviderCost(CEILING, CEILING)).toEqual({ trusted: true, costUsd: CEILING })
  })

  it('零 → 采信（免费额度不是错误）', () => {
    expect(trustProviderCost(0, CEILING)).toEqual({ trusted: true, costUsd: 0 })
  })

  // 下面每一个都是真实的污染手法，不是形式主义：
  // NaN 一旦进账，之后所有 `remaining < upperBound` 恒为 false —— 预算闸门静默失效。
  for (const [label, poisoned] of [
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ] as const) {
    it(`${label} → 不采信`, () => {
      const r = trustProviderCost(poisoned, CEILING)
      expect(r.trusted).toBe(false)
    })
  }

  it('负数 → 不采信（等于把钱还回来、凭空扩大额度）', () => {
    expect(trustProviderCost(-1, CEILING).trusted).toBe(false)
  })

  it('超过声明上界 → 不采信（批的和花的对不上）', () => {
    expect(trustProviderCost(CEILING + 0.0001, CEILING).trusted).toBe(false)
  })

  it('上界本身非法 → 不采信（说不出上界的付费步骤一律 fail closed）', () => {
    expect(trustProviderCost(0.01, Number.NaN).trusted).toBe(false)
    expect(trustProviderCost(0.01, -1).trusted).toBe(false)
  })
})
