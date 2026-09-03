/**
 * #1347 · GEO 预算账本：fail-closed + 并发不双花 + budgetUsd 来源唯一。
 */
import { describe, it, expect } from 'vitest'
import { resolveClientGeoBudget, geoBudgetPeriodKey } from '../budget-ledger'
import { FakeGeoBudgetStore } from './fake-budget-store'

const C = 'c0000000-0000-0000-0000-000000000000'
const P = '2026-09'

describe('resolveClientGeoBudget — fail-closed', () => {
  it('没有预算行 → 不授权（PM 没批额度就不许自动花钱）', async () => {
    const store = new FakeGeoBudgetStore() // 不 setCap
    const r = await resolveClientGeoBudget(store, { clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    expect(r.authorized).toBe(false)
    if (!r.authorized) expect(r.reason).toBe('no_budget_row')
  })
  it('worstCase 非正数 / NaN → 不授权，且不碰 store', async () => {
    const store = new FakeGeoBudgetStore(); store.setCap(C, P, 100)
    for (const bad of [0, -1, NaN, Infinity]) {
      const r = await resolveClientGeoBudget(store, { clientId: C, periodKey: P, worstCaseUsd: bad })
      expect(r.authorized).toBe(false)
    }
    expect(store.snapshot(C, P)).toEqual({ cap: 100, reserved: 0, spent: 0 }) // 一分没预留
  })
})

describe('resolveClientGeoBudget — 授权额度就是预留额度', () => {
  it('额度足 → 授权，budgetUsd 恰等于 worstCase（不多不少，非 env）', async () => {
    const store = new FakeGeoBudgetStore(); store.setCap(C, P, 5)
    const r = await resolveClientGeoBudget(store, { clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    expect(r.authorized).toBe(true)
    if (r.authorized) {
      expect(r.budgetUsd).toBe(1.8)
      expect(r.remainingUsd).toBeCloseTo(3.2)
    }
    expect(store.snapshot(C, P)).toEqual({ cap: 5, reserved: 1.8, spent: 0 })
  })
})

describe('并发不双花（魏征 #1 的核心）', () => {
  it('额度只够一次时，两次预留只有一次成功', async () => {
    const store = new FakeGeoBudgetStore(); store.setCap(C, P, 2) // 只够一次 1.8
    const a = await resolveClientGeoBudget(store, { clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    const b = await resolveClientGeoBudget(store, { clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    const authed = [a, b].filter((x) => x.authorized).length
    expect(authed).toBe(1) // 第二个入口被账本拦下，不是两个都满额通过
    const refused = [a, b].find((x) => !x.authorized)
    if (refused && !refused.authorized) expect(refused.reason).toBe('insufficient')
    expect(store.snapshot(C, P)!.reserved).toBe(1.8) // 只预留了一次
  })
  it('reserved + spent 永不超过 cap（多次预留累加到顶就拒）', async () => {
    const store = new FakeGeoBudgetStore(); store.setCap(C, P, 5)
    let ok = 0
    for (let i = 0; i < 10; i++) {
      const r = await resolveClientGeoBudget(store, { clientId: C, periodKey: P, worstCaseUsd: 1.8 })
      if (r.authorized) ok++
    }
    expect(ok).toBe(2) // 5 / 1.8 = 2 次
    const snap = store.snapshot(C, P)!
    expect(snap.reserved + snap.spent).toBeLessThanOrEqual(5)
  })
})

describe('结算把预留挪成实际花费', () => {
  it('actual < reserved → 释放预留、只按 actual 扣，余额回补', async () => {
    const store = new FakeGeoBudgetStore(); store.setCap(C, P, 5)
    await resolveClientGeoBudget(store, { clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    await store.settle(C, P, 1.8, 0.63) // 最坏 1.8，实际只花 0.63
    const snap = store.snapshot(C, P)!
    expect(snap.reserved).toBe(0)
    expect(snap.spent).toBeCloseTo(0.63)
    // 释放后又能再预留（余额回来了）
    const again = await resolveClientGeoBudget(store, { clientId: C, periodKey: P, worstCaseUsd: 4 })
    expect(again.authorized).toBe(true)
  })
  it('actual 报得比预留还高 → 不采信，最多按预留上界扣（provider 成本是输入不是事实）', async () => {
    const store = new FakeGeoBudgetStore(); store.setCap(C, P, 5)
    await resolveClientGeoBudget(store, { clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    const s = await store.settle(C, P, 1.8, 999)
    expect(s.chargedUsd).toBe(1.8)
  })
})

describe('geoBudgetPeriodKey', () => {
  it('给出 UTC 的 YYYY-MM', () => {
    expect(geoBudgetPeriodKey(new Date(Date.UTC(2026, 8, 4)))).toBe('2026-09')
    expect(geoBudgetPeriodKey(new Date(Date.UTC(2026, 0, 31)))).toBe('2026-01')
  })
})
