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
