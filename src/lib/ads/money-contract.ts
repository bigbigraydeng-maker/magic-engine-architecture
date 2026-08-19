/**
 * 广告中枢 v1 Money Contract —— NZD/USD 换算的唯一入口。
 *
 * ── 为什么这里不是"2 个常量 + 1 个 helper"（Build Control 木桶原则修订）──────
 * 最初的精简方案想把这里砍到只剩常量。Build Control 裁决明确要求保留完整
 * 记录：汇率、来源/PO 口径、锁定时间、NZD/USD 两个金额、安全舍入方向 ——
 * 因为 Kernel 记美元、Meta 账户和这张预留表记纽币，任何一次审批决策的
 * 审计记录里，缺了"这个数是怎么换算出来的"就没法回答"当时批的到底是多少钱"。
 *
 * ── 为什么不做成可插拔的汇率来源（config / wise_api / ... 策略模式）─────────
 * v1 只有一个真实来源：PM 口径给的固定值。做成策略模式是在为"以后可能接汇率
 * API"这件事预先设计接口，而那件事现在既没有上游需求也没有下游消费方
 * （Build Control 第一轮：上游提供不了、下游消费不了的精度不提前建设）。
 * 等真的要接 API 时，`lockV1SandboxMoney` 这一个函数签名不变，内部实现换掉
 * 汇率来源即可 —— 调用方（Capability）不需要知道汇率从哪来。
 *
 * ── 舍入方向 ──────────────────────────────────────────────────────────────
 * NZD → USD 向上舍（ceil）：Kernel 看到的美元上限只是审批记录里的展示值，
 * 真正拦钱的判定点在 `spend-reservations.ts` 的纽币预留表，所以这里舍入
 * 保守与否不影响实际拦截；但账目一致性要求"宁可让审批记录显得贵一点，
 * 不能显得比实际便宜"，所以仍然向上舍。
 */

export interface MoneyAmount {
  /** 纽币金额（原始输入，未经任何换算）。 */
  amountNzd: number
  /** 按 rate 换算出的美元金额，已向上舍入到分。 */
  amountUsd: number
  /** NZD → USD 汇率。 */
  rate: number
  /** 这个汇率是谁定的、依据什么 —— 不是抽象来源枚举，是一句人话说明。 */
  rateSource: string
  /** 锁定这个汇率的那一刻（ISO timestamp）。 */
  lockedAt: string
}

/** v1 sandbox 固定汇率。CTS 广告账户结算币种是 NZD，Kernel 记账是 USD。 */
export const V1_SANDBOX_NZD_TO_USD_RATE = 0.6

/**
 * 这个汇率的口径说明 —— 写进每一条 policy_snapshot / authorization_decisions，
 * 让审计记录能追溯"当时为什么用这个数"，不是一个凭空的常量。
 */
export const V1_SANDBOX_RATE_SOURCE =
  'PM 口径 2026-08-20：ME 广告中枢 v1 sandbox 测试用 ME 自担预算，' +
  '允许汇率误差（不接实时汇率 API），固定值 0.60 供审批记录换算展示用；' +
  '真正拦截真钱的判定点在 ads_spend_reservations 的纽币预留表，不在这个换算值。'

/**
 * 锁定一笔纽币金额对应的美元换算值，供 Kernel 审批记录使用。
 *
 * @param amountNzd 纽币金额（正数）
 * @param now 锁定时刻；测试时可传固定值，生产调用不传即用当前时间
 */
export function lockV1SandboxMoney(amountNzd: number, now: Date = new Date()): MoneyAmount {
  if (!Number.isFinite(amountNzd) || amountNzd < 0) {
    throw new Error(`lockV1SandboxMoney: amountNzd 必须是非负实数，实际是 ${amountNzd}`)
  }
  const rate = V1_SANDBOX_NZD_TO_USD_RATE
  // 向上舍入到分：Math.ceil(x * 100) / 100，避免浮点误差把 0.005 之类的边界舍错方向
  const amountUsd = Math.ceil(amountNzd * rate * 100) / 100
  return {
    amountNzd,
    amountUsd,
    rate,
    rateSource: V1_SANDBOX_RATE_SOURCE,
    lockedAt: now.toISOString(),
  }
}
