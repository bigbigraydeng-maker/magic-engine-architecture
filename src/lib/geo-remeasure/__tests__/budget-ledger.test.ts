/**
 * #1347 · GEO 预算账本应用层判据：fail-closed + 不双花 + 幂等（三审必改）+ budgetUsd 唯一来源。
 * 🔴 SQL 层原子/并发行为另由 scripts/geo-budget-ledger-check.sh 在真 postgres 断言。
 */
import { describe, it, expect } from 'vitest'
import { resolveClientGeoBudget, geoBudgetPeriodKey } from '../budget-ledger'
import { FakeGeoBudgetStore } from './fake-budget-store'

const C = 'c0000000-0000-0000-0000-000000000000'
const P = '2026-09'
const rid = (s: string) => `batch-${s}`

describe('resolveClientGeoBudget — fail-closed', () => {
  it('没有预算行 → 不授权（no_budget_row）', async () => {
    const s = new FakeGeoBudgetStore()
    const r = await resolveClientGeoBudget(s, { reservationId: rid('1'), clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    expect(r.authorized).toBe(false); if (!r.authorized) expect(r.reason).toBe('no_budget_row')
  })
  it('缺 reservationId → 不授权，不碰 store', async () => {
    const s = new FakeGeoBudgetStore(); s.setCap(C, P, 100)
    const r = await resolveClientGeoBudget(s, { reservationId: '', clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    expect(r.authorized).toBe(false); if (!r.authorized) expect(r.reason).toBe('invalid_reservation_id')
    expect(s.snapshot(C, P)).toEqual({ cap: 100, reserved: 0, spent: 0 })
  })
  it('worstCase 非正/NaN/Inf → 不授权', async () => {
    const s = new FakeGeoBudgetStore(); s.setCap(C, P, 100)
    for (const bad of [0, -1, NaN, Infinity]) {
      const r = await resolveClientGeoBudget(s, { reservationId: rid(String(bad)), clientId: C, periodKey: P, worstCaseUsd: bad })
      expect(r.authorized).toBe(false)
    }
    expect(s.snapshot(C, P)!.reserved).toBe(0)
  })
})

describe('授权额度 = 预留额度', () => {
  it('额度足 → budgetUsd 恰等于 worstCase，reservationId 回传', async () => {
    const s = new FakeGeoBudgetStore(); s.setCap(C, P, 5)
    const r = await resolveClientGeoBudget(s, { reservationId: rid('x'), clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    expect(r.authorized).toBe(true)
    if (r.authorized) { expect(r.budgetUsd).toBe(1.8); expect(r.reservationId).toBe(rid('x')) }
    expect(s.snapshot(C, P)).toEqual({ cap: 5, reserved: 1.8, spent: 0 })
  })
})

describe('不双花（魏征 #1）', () => {
  it('额度只够一次时，两个不同批次只有一个成功', async () => {
    const s = new FakeGeoBudgetStore(); s.setCap(C, P, 2)
    const a = await resolveClientGeoBudget(s, { reservationId: rid('a'), clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    const b = await resolveClientGeoBudget(s, { reservationId: rid('b'), clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    expect([a, b].filter((x) => x.authorized).length).toBe(1)
    expect(s.snapshot(C, P)!.reserved).toBe(1.8)
  })
})

describe('幂等（三审必改：Inngest 会重试）', () => {
  it('同一 reservationId 重复 reserve → 只累加一次', async () => {
    const s = new FakeGeoBudgetStore(); s.setCap(C, P, 5)
    await resolveClientGeoBudget(s, { reservationId: rid('same'), clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    const again = await resolveClientGeoBudget(s, { reservationId: rid('same'), clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    expect(again.authorized).toBe(true)
    expect(s.snapshot(C, P)!.reserved).toBe(1.8) // 不是 3.6
  })
  it('重复 settle 同一批次 → 花费只记一次（魏征实测 0.63→1.26 的根治）', async () => {
    const s = new FakeGeoBudgetStore(); s.setCap(C, P, 5)
    await resolveClientGeoBudget(s, { reservationId: rid('s'), clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    const first = await s.settle(rid('s'), 0.63)
    const second = await s.settle(rid('s'), 0.63)
    expect(first.chargedUsd).toBeCloseTo(0.63)
    expect(second.idempotent).toBe(true)
    expect(s.snapshot(C, P)!.spent).toBeCloseTo(0.63) // 不是 1.26
    expect(s.snapshot(C, P)!.reserved).toBe(0)
  })
})

describe('结算把预留挪成实际花费', () => {
  it('actual < worstCase → 只按 actual 扣，余额回补可再预留', async () => {
    const s = new FakeGeoBudgetStore(); s.setCap(C, P, 5)
    await resolveClientGeoBudget(s, { reservationId: rid('1'), clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    await s.settle(rid('1'), 0.63)
    expect(s.snapshot(C, P)!.spent).toBeCloseTo(0.63)
    const again = await resolveClientGeoBudget(s, { reservationId: rid('2'), clientId: C, periodKey: P, worstCaseUsd: 4 })
    expect(again.authorized).toBe(true)
  })
  it('actual 报得比预留高 → 最多按预留上界扣', async () => {
    const s = new FakeGeoBudgetStore(); s.setCap(C, P, 5)
    await resolveClientGeoBudget(s, { reservationId: rid('1'), clientId: C, periodKey: P, worstCaseUsd: 1.8 })
    const r = await s.settle(rid('1'), 999)
    expect(r.chargedUsd).toBe(1.8)
  })
  it('结算不存在的预留 → no_reservation（不凭空扣）', async () => {
    const s = new FakeGeoBudgetStore(); s.setCap(C, P, 5)
    const r = await s.settle('ghost', 1)
    expect(r.settled).toBe(false); expect(r.reason).toBe('no_reservation')
  })
})

describe('geoBudgetPeriodKey', () => {
  it('给出 UTC 的 YYYY-MM', () => {
    expect(geoBudgetPeriodKey(new Date(Date.UTC(2026, 8, 4)))).toBe('2026-09')
    expect(geoBudgetPeriodKey(new Date(Date.UTC(2026, 0, 31)))).toBe('2026-01')
  })
})
