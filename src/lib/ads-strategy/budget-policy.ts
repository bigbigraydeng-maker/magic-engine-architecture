/**
 * 广告预算政策常量 —— **叶子模块，零 import，服务端与浏览器端共用一份**。
 *
 * 🔴 为什么单开一个文件：这条常量原本住在 `pm-todo/ads-angle-test-items.ts`，
 *    而那个文件 import 了 `ads-strategy/config`，config 又 import 了
 *    `supabaseAdmin`（service-role 客户端）—— 在 `'use client'` 的设置页里
 *    import 它会把 service-role 客户端拖进浏览器 bundle。于是设置页只能把
 *    `× 0.2` 硬编码，全仓变成**三处各写一份**（设置页两处 + 服务端常量）。
 *
 *    20% 是 Product Owner 拍板、将来会改的业务政策（不是自然常数）。
 *    三处各写一份，改的时候必然漏一个 —— 那时今日待办会说「拿 15% 出来试」、
 *    设置页会说「20%」，两套口径同时出现在同一个 FDE 眼前。
 */

/**
 * 每月拿多少比例去试没验证过的说法 —— **Product Owner 决议（2026-08-15）**。
 *
 * 口径见 SOP §0：这是**整月共享池**，逐轮扣减，不是每轮各拿 20%。改它要 PO 点头。
 */
export const EXPLORATION_BUDGET_SHARE = 0.2

/** 给人看的百分比（整数），文案里用它，不要再手写一次 `20`。 */
export const EXPLORATION_BUDGET_PCT = Math.round(EXPLORATION_BUDGET_SHARE * 100)

/** 本月探索池 = 月预算 × 政策比例。纯函数，好测。 */
export function explorationPool(monthlyBudget: number): number {
  return monthlyBudget * EXPLORATION_BUDGET_SHARE
}
