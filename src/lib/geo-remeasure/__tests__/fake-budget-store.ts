/**
 * 假 GeoBudgetStore：内存建模 geo_client_budgets 表 + 同一套原子判据。
 * 🔴 按**表**建模（cap/reserved/spent 三个累加器），不是按调用次序 —— 这样改了 migration
 *    的判据、这里没同步，测试会红（feedback-fake-supabase-must-model-table-not-callorder）。
 */
import type { GeoBudgetStore, GeoBudgetReserveResult, GeoBudgetSettleResult } from '../budget-ledger'

interface Row { cap: number; reserved: number; spent: number }

export class FakeGeoBudgetStore implements GeoBudgetStore {
  private rows = new Map<string, Row>()

  /** 测试初始化：给某客户某窗口设一个 PM 授权额度。不调 = 没有预算行（fail-closed 场景）。 */
  setCap(clientId: string, periodKey: string, capUsd: number): void {
    this.rows.set(`${clientId}::${periodKey}`, { cap: capUsd, reserved: 0, spent: 0 })
  }
  snapshot(clientId: string, periodKey: string): Row | undefined {
    const r = this.rows.get(`${clientId}::${periodKey}`)
    return r ? { ...r } : undefined
  }

  async reserve(clientId: string, periodKey: string, worstCaseUsd: number): Promise<GeoBudgetReserveResult> {
    if (!(worstCaseUsd > 0)) return { reserved: false, reason: 'invalid_worst_case' }
    const row = this.rows.get(`${clientId}::${periodKey}`)
    if (!row) return { reserved: false, reason: 'no_budget_row' } // fail-closed：没批额度
    const remaining = row.cap - row.reserved - row.spent
    if (remaining < worstCaseUsd) return { reserved: false, reason: 'insufficient', remainingUsd: remaining }
    row.reserved += worstCaseUsd // 原子累加：第二次预留看到的是累加后的 reserved
    return { reserved: true, remainingUsd: remaining - worstCaseUsd }
  }

  async settle(clientId: string, periodKey: string, reservedUsd: number, actualUsd: number): Promise<GeoBudgetSettleResult> {
    if (reservedUsd < 0 || actualUsd < 0) return { settled: false, reason: 'invalid_amounts' }
    const row = this.rows.get(`${clientId}::${periodKey}`)
    if (!row) return { settled: false, reason: 'no_budget_row' }
    const release = Math.min(row.reserved, reservedUsd)
    const charge = Math.min(actualUsd, reservedUsd)
    row.reserved -= release
    row.spent += charge
    return { settled: true, chargedUsd: charge }
  }
}
