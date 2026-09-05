/**
 * Magic Engine 2.0 · GEO 重测编排（Issue #1347 · 切片 3a · 接线）
 *
 * 🔴 **本文件是"把账本 + 批次 runtime + settle 串起来"的最小编排**：
 *      authorize（原子预留额度）→ runBatch（调用方给的批次执行函数）→ settle（结算实付）。
 *    不装配 provider / parse / store —— 那是调用侧（Inngest 消费者 / geo-baseline-run.ts）的责任。
 *    这样 runner 保持纯逻辑、可直测；provider 装配只需要写一次（在 Inngest 消费者里），
 *    脚本入口也走同一个 runner，不会因为两条入口各自装配而漂移。
 *
 * 🔴 **状态机与 fail-closed**：
 *      · budget 预留失败（额度不足、身份不符、已结算 / 已回收）→ `blocked`，不跑 batch。
 *      · runBatch 抛异常 → `batch_failed`，尽力 settle actual=0 释放预留（若返回失败也如实报告；
 *        不吞异常、不把它当成成功）。
 *      · runBatch 正常返回 → 用其 `actualUsd` 走 settle。settle 失败一律如实回报，不静默。
 *
 * 🔴 **成本策略**：`runBatch` 的调用者必须自己决定 `actualUsd` 的口径：
 *      known 就用 known；unknown 就传 `worstCaseUsd`（预留上界，保守）。这条判据放在调用侧
 *      因为它需要看 provider 结果的具体形状（`GeoMaybeUnknown<number>`），runner 不能替它猜。
 */

import type { GeoBudgetStore } from './budget-ledger'
import { resolveClientGeoBudget, type GeoBudgetAuthorization } from './budget-ledger'

/** runBatch 契约：调用者装配好 provider/parse/store，跑一批次，返回归一化的结果。 */
export interface RemeasureBatchResult {
  /** 实际计费金额（USD）。unknown 时调用者必须以 worstCaseUsd 传，保守扣款。 */
  readonly actualUsd: number
  /** 批次 id（供 receipt / 观测追踪）。批次未开始或 preflight 拒时可以为 null。 */
  readonly batchId: string | null
  /** 批次终态（completed / partial / failed / not_started 等）。原样透传给 receipt。 */
  readonly status: string
  /** 附加细节，写进 receipt，透明可审计。 */
  readonly detail?: Record<string, unknown>
}

/** 调用者提供的批次执行函数。runner 不装配 provider，只在授权成功后调这个。 */
export type RemeasureBatchRunner = () => Promise<RemeasureBatchResult>

export interface RemeasureRequest {
  readonly reservationId: string
  readonly clientId: string
  readonly periodKey: string
  readonly worstCaseUsd: number
}

/** runner 的终态。字段全部 optional 或 discriminated，方便映射到 receipt / Inngest 返回值。 */
export type RemeasureOutcome =
  | { readonly kind: 'blocked'; readonly reason: string }
  | { readonly kind: 'batch_failed'; readonly reservationId: string; readonly reason: string; readonly settleReleased: boolean }
  | { readonly kind: 'settle_failed'; readonly reservationId: string; readonly batchId: string | null; readonly status: string; readonly reason: string }
  | { readonly kind: 'completed'; readonly reservationId: string; readonly batchId: string | null; readonly status: string; readonly chargedUsd: number }

/**
 * 编排一次自动重测：授权 → 跑批次 → 结算。
 *
 * 🔴 幂等性由**调用者**通过 `reservationId` 保证（同一次逻辑重测用同一个 id）。
 *    Inngest step 天然幂等；scripts/geo-baseline-run.ts 是人手触发，reservationId 由 PM/系统构造。
 *    本函数不生成 reservationId —— 生成即绑定语义，容易和 Inngest step 的幂等键漂移。
 *
 * 🔴 crash-after-provider-before-settle（Codex 提示）：这一层保不住 —— 如果 runBatch 已经调 provider
 *    花了钱、进程紧接着崩了，settle 不会跑。真防线在 Inngest step：measure step 和 settle step
 *    在同一个函数里独立分段，重试整个 run 时同一 step id 会拿到既有结果（durable execution）。
 */
export async function authorizeMeasureSettle(
  req: RemeasureRequest,
  budget: GeoBudgetStore,
  runBatch: RemeasureBatchRunner,
): Promise<RemeasureOutcome> {
  const auth: GeoBudgetAuthorization = await resolveClientGeoBudget(budget, req)
  if (!auth.authorized) {
    return { kind: 'blocked', reason: auth.reason }
  }

  let batch: RemeasureBatchResult
  try {
    batch = await runBatch()
  } catch (e) {
    // 批次抛错（含 preflight 拒、装配错误、provider 网络挂等）—— 尽力释放预留。
    // settle actual=0 是"没花钱"的保守表达。若 batch 内部其实已经花了部分钱，那笔损失
    // 无法从预留侧回补，但账本至少不会误记为大额支出；provider 侧账单是唯一真相。
    const message = e instanceof Error ? e.message : String(e)
    let released = false
    try {
      const s = await budget.settle(auth.reservationId, 0)
      released = s.settled === true
    } catch {
      released = false
    }
    return { kind: 'batch_failed', reservationId: auth.reservationId, reason: message, settleReleased: released }
  }

  // 保护：actualUsd 必须是有限非负数；异常值一律以 worstCase 保守扣（宁多不少）。
  const safeActual =
    Number.isFinite(batch.actualUsd) && batch.actualUsd >= 0 ? batch.actualUsd : req.worstCaseUsd

  const settled = await budget.settle(auth.reservationId, safeActual)
  if (!settled.settled) {
    return {
      kind: 'settle_failed',
      reservationId: auth.reservationId,
      batchId: batch.batchId,
      status: batch.status,
      reason: settled.reason ?? 'unknown_settle_error',
    }
  }
  return {
    kind: 'completed',
    reservationId: auth.reservationId,
    batchId: batch.batchId,
    status: batch.status,
    chargedUsd: settled.chargedUsd ?? safeActual,
  }
}
