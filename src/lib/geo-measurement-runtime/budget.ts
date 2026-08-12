/**
 * Magic Engine 2.0 · GEO Measurement Runtime —— 预算 preflight（Issue #874 / WP04）
 *
 * 🔴 **纯函数，fail-closed。** 授权第 4 条：第一次外部调用前做一次；此后**每一次
 *    可能收费的尝试 / 重试之前**都要再判一次。说不出下一步成本上界 → 一律不放行。
 */

export interface GeoBudgetDecision {
  readonly allowed: boolean
  readonly reason: string
}

function isFiniteNonNegative(v: number): boolean {
  return Number.isFinite(v) && v >= 0
}

/**
 * 判断「还能不能发起下一次可能收费的调用」。
 *
 * @param remainingUsd            剩余授权额度 = 批次上限 − 已（最坏情况）花掉的
 * @param nextCostUpperBoundUsd   下一步调用的成本上界（说不出上界 = 传 NaN/负数 → 拒）
 *
 * 🔴 `remaining < nextUpperBound` → 拒（钱可能不够，宁可停）。
 * 🔴 任一数不是有限非负 → 拒（成本上界不明的付费步骤一律 fail closed）。
 */
export function preflightBudget(remainingUsd: number, nextCostUpperBoundUsd: number): GeoBudgetDecision {
  if (!isFiniteNonNegative(nextCostUpperBoundUsd)) {
    return { allowed: false, reason: 'next-call cost upper bound is unknown or invalid; fail closed' }
  }
  if (!isFiniteNonNegative(remainingUsd)) {
    return { allowed: false, reason: 'remaining authorization is unknown or invalid; fail closed' }
  }
  if (remainingUsd < nextCostUpperBoundUsd) {
    return {
      allowed: false,
      reason: `remaining ${remainingUsd} < next-call upper bound ${nextCostUpperBoundUsd}`,
    }
  }
  return { allowed: true, reason: 'within authorization' }
}

export type GeoCostTrustResult =
  | { readonly trusted: true; readonly costUsd: number }
  | { readonly trusted: false; readonly reason: string }

/**
 * provider 报回来的花费**不能直接信**。
 *
 * 🔴 provider 是外部系统，它报的成本是**输入**，不是事实 —— 一个 `NaN` / `Infinity` /
 *    负数会当场污染预算账：`spent += NaN` 之后所有 preflight 的比较恒为 false（NaN 参与
 *    的比较永远不成立），预算闸门就此静默失效，后面每一次调用都会被放行。负数更糟：
 *    它会把已花的钱「还」回来，等于凭空扩大授权额度。
 * 🔴 超过本次声明的成本上界同样不可信 —— preflight 就是拿这个上界批的额度，
 *    实报超上界说明「批的」和「花的」对不上，此时继续跑就是在花没批过的钱。
 *
 * 判据与 WP03 `geo_batches_cost_is_a_real_amount` 同构（那条 CHECK 在写入时兜底，
 * 这条在**发起下一次调用之前**兜底）。
 */
export function trustProviderCost(reported: number, ceilingUsd: number): GeoCostTrustResult {
  if (typeof reported !== 'number' || !Number.isFinite(reported)) {
    return { trusted: false, reason: `provider reported a non-finite cost (${String(reported)})` }
  }
  if (reported < 0) {
    return { trusted: false, reason: `provider reported a negative cost (${reported})` }
  }
  if (!Number.isFinite(ceilingUsd) || ceilingUsd < 0) {
    return { trusted: false, reason: `declared per-call cost ceiling is invalid (${String(ceilingUsd)})` }
  }
  if (reported > ceilingUsd) {
    return { trusted: false, reason: `provider reported ${reported}, above the declared ceiling ${ceilingUsd}` }
  }
  return { trusted: true, costUsd: reported }
}
