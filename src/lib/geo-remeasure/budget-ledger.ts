/**
 * Magic Engine 2.0 · GEO 自动重测的每客户预算账本（Issue #1347）
 *
 * 🔴 **这是 preflightBudget 之前那一层。** WP04 的 `preflightBudget`
 *    （src/lib/geo-measurement-runtime/budget.ts:26）只在单次进程内存账上工作，
 *    对「两个入口并发各自满额」无能为力（魏征复审 #1）。本层提供**跨进程、原子**的
 *    额度来源：一次成功的 `reserve` 才产出 `plan.budgetUsd`，绝不从 env / 硬编码来。
 *
 * 🔴 **fail-closed**：没有预算行 = 拒绝（PM 没批额度就不许自动花钱），绝不自动建默认额度。
 * 🔴 判断+累加的原子性由数据库 RPC（`geo_reserve_budget_v1` 的 `FOR UPDATE` + WHERE 判据）
 *    保证；本层只做「调 RPC → 把结果翻成授权/拒绝」，不自己算余额（算了就又回到内存账的老路）。
 */

export type GeoBudgetReserveReason = 'no_budget_row' | 'insufficient' | 'invalid_worst_case'

export interface GeoBudgetReserveResult {
  readonly reserved: boolean
  readonly reason?: GeoBudgetReserveReason
  readonly remainingUsd?: number
}

export interface GeoBudgetSettleResult {
  readonly settled: boolean
  readonly reason?: string
  readonly chargedUsd?: number
}

/** 账本存储契约。真实实现走 Supabase RPC；测试用假件（内存表，同一套判据）。 */
export interface GeoBudgetStore {
  reserve(clientId: string, periodKey: string, worstCaseUsd: number): Promise<GeoBudgetReserveResult>
  settle(clientId: string, periodKey: string, reservedUsd: number, actualUsd: number): Promise<GeoBudgetSettleResult>
}

/** 授权结果：授权时 `budgetUsd` **就是**已预留的最坏成本，供下游 preflightBudget 使用。 */
export type GeoBudgetAuthorization =
  | { readonly authorized: true; readonly budgetUsd: number; readonly periodKey: string; readonly remainingUsd: number }
  | { readonly authorized: false; readonly reason: GeoBudgetReserveReason }

/** YYYY-MM 预算窗口键。由调用方传 Date（可测），不在库里读时钟。 */
export function geoBudgetPeriodKey(now: Date): string {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/**
 * 自动重测的唯一额度来源：原子预留成功 → 返回可用作 `plan.budgetUsd` 的授权额度。
 * 🔴 `budgetUsd` 恒等于本次预留的 `worstCaseUsd`，不多不少 —— 下游花的钱不会超过这里预留的。
 */
export async function resolveClientGeoBudget(
  store: GeoBudgetStore,
  args: { clientId: string; periodKey: string; worstCaseUsd: number },
): Promise<GeoBudgetAuthorization> {
  if (!(args.worstCaseUsd > 0) || !Number.isFinite(args.worstCaseUsd)) {
    return { authorized: false, reason: 'invalid_worst_case' }
  }
  const r = await store.reserve(args.clientId, args.periodKey, args.worstCaseUsd)
  if (!r.reserved) {
    return { authorized: false, reason: r.reason ?? 'insufficient' }
  }
  return {
    authorized: true,
    budgetUsd: args.worstCaseUsd,
    periodKey: args.periodKey,
    remainingUsd: r.remainingUsd ?? 0,
  }
}
