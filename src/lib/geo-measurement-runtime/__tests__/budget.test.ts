/**
 * 预算 preflight —— 授权第 4 条（Issue #874 / WP04）。
 * 说不出成本上界一律 fail closed；剩余不够一律不放行。
 */

import { describe, it, expect } from 'vitest'
import { preflightBudget } from '../budget'

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
