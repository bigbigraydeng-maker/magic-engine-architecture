/**
 * 四道闸 + 判定 —— Product Intelligence 的全部业务逻辑，纯函数，无 IO。
 *
 * 🔴 **这不是销量预测模型，是排除模型。** 没人能预测一个品会不会爆；能确定的是
 *    「中国有货源 + 美国已被消费者验证 + 澳新有人搜且没在跌 + 毛利够」这四条
 *    同时不成立时**不值得测**。判定的作用是把候选压到少数几个，真正的判据是
 *    之后那 NZ$50 广告跑 48 小时 —— 那一段属于 DAPE 的 E（执行），不在这个文件里。
 *
 * 🔴 **缺数据一律 UNKNOWN，不猜、不给默认值。** UNKNOWN ≠ 不好。
 */

import type {
  GateResult,
  MarketDemand,
  ProductCandidate,
  ScoredCandidate,
  Verdict,
} from './types'

/**
 * 累计销量门槛。1,000 件 = 已经过了「几个朋友捧场」的量级，
 * 是真实消费者反复买出来的。实测样本里 20 条有 4 条过线，筛出率合理。
 */
const MIN_CUMULATIVE_SOLD = 1_000

/** 澳新月搜索量合计门槛。低于这个量，就算转化率 100% 也撑不起投放。 */
const MIN_AUNZ_MONTHLY_SEARCHES = 200

/**
 * 毛利倍数门槛 —— **粗筛用，不是判据**。
 *
 * 5 倍是从真实成本反解出来的，不是行业经验：PM 2026-08-15 提供实际费率
 * （本地快递 NZ$3.99/件、中国到新西兰 NZ$2.00/kg）后实算 ——
 * 货价 US$4.50、计费重量 0.8kg 的小件，到岸 NZ$11.45，
 * 做到 **50% 毛利需要标价 NZ$38.79 = 货价的 5.1 倍**。
 *
 * 通行的「3 倍」在新西兰不成立：每单有一笔**与货价无关的固定成本** NZ$6.50
 * （本地配送 3.99 + 低值货物征费 2.21 + 支付固定费 0.30），GST 再从标价拿走 13%。
 * 货价越低，这笔固定成本占比越离谱 —— 所以倍数在低价位段一定失真，
 * 它按比例缩放而固定成本不缩放。
 *
 * 🔴 **这道闸用的是美国售价当价格代理，会偏保守。** 实测同一件便携榨汁机
 *    美国 TikTok 卖 US$15.86，新西兰 Trade Me 主流带在 NZ$29.90–34.90
 *    （≈US$17.6–20.6，**比美国高约 30%**）。所以按美国价算不过关的品，
 *    换成新西兰实际售价可能是过得去的 —— 误杀比误放行安全，先这样。
 *
 * 🔴 真正的判据是 `landed-cost.ts` 的完整模型（到岸 + 本地配送 + 支付 + GST
 *    → 每单广告上限）。它需要**计费重量**和**新西兰市场售价**，两个都拿到之后
 *    一律以完整模型为准，这道闸只负责在拿到之前先砍掉明显不行的。
 */
const MIN_MARGIN_MULTIPLE = 5

function gateProvenDemand(candidate: ProductCandidate): GateResult {
  const sold = candidate.cumulativeSold.value
  if (sold === null) {
    return { gate: 'proven_demand', outcome: 'UNKNOWN', reason: '平台没有返回累计销量' }
  }
  return {
    gate: 'proven_demand',
    outcome: sold >= MIN_CUMULATIVE_SOLD ? 'PASS' : 'FAIL',
    reason: `美国累计已售 ${sold.toLocaleString()} 件（门槛 ${MIN_CUMULATIVE_SOLD.toLocaleString()}）`,
  }
}

function totalSearches(demand: readonly MarketDemand[]): number | null {
  const values = demand
    .map((d) => d.monthlySearches.value)
    .filter((v): v is number => v !== null)
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0)
}

function gateAuNzSearched(demand: readonly MarketDemand[]): GateResult {
  const total = totalSearches(demand)
  if (total === null) {
    return { gate: 'aunz_searched', outcome: 'UNKNOWN', reason: '澳新搜索量取不到' }
  }
  return {
    gate: 'aunz_searched',
    outcome: total >= MIN_AUNZ_MONTHLY_SEARCHES ? 'PASS' : 'FAIL',
    reason: `AU+NZ 月搜索量合计 ${total.toLocaleString()}（门槛 ${MIN_AUNZ_MONTHLY_SEARCHES}）`,
  }
}

function gateNotDeclining(demand: readonly MarketDemand[]): GateResult {
  const known = demand
    .map((d) => ({ market: d.market, value: d.trajectory.value }))
    .filter((t): t is { market: 'AU' | 'NZ'; value: 'rising' | 'flat' | 'declining' } =>
      t.value !== null)

  if (known.length === 0) {
    return { gate: 'aunz_not_declining', outcome: 'UNKNOWN', reason: '澳新趋势曲线取不到' }
  }
  const detail = known.map((t) => `${t.market}=${t.value}`).join(' · ')
  const allDeclining = known.every((t) => t.value === 'declining')
  return {
    gate: 'aunz_not_declining',
    outcome: allDeclining ? 'FAIL' : 'PASS',
    reason: `12 个月轨迹 ${detail}`,
  }
}

function gateMargin(candidate: ProductCandidate): GateResult {
  const retail = candidate.retailPriceUsd.value
  const cost = candidate.sourcing?.medianUnitCostUsd.value ?? null
  if (retail === null || cost === null || cost <= 0) {
    return {
      gate: 'margin_multiple',
      outcome: 'UNKNOWN',
      reason: cost === null ? '没找到中国供货报价' : '缺零售价',
    }
  }
  const multiple = retail / cost
  return {
    gate: 'margin_multiple',
    outcome: multiple >= MIN_MARGIN_MULTIPLE ? 'PASS' : 'FAIL',
    reason: `美国售价 US$${retail.toFixed(2)} ÷ 货价 US$${cost.toFixed(2)} = `
      + `${multiple.toFixed(1)}×（门槛 ${MIN_MARGIN_MULTIPLE}×，粗筛；`
      + `新西兰实际售价通常更高，此闸偏保守）`,
  }
}

/** 核心闸 —— 这两道 UNKNOWN 就判不了，不能降级成 WATCH。 */
const CORE_GATES = new Set(['proven_demand', 'aunz_searched'])

function decideVerdict(gates: readonly GateResult[]): Verdict {
  if (gates.some((g) => g.outcome === 'FAIL')) return 'REJECT'
  if (gates.every((g) => g.outcome === 'PASS')) return 'TEST_NOW'
  const coreUnknown = gates.some(
    (g) => g.outcome === 'UNKNOWN' && CORE_GATES.has(g.gate),
  )
  return coreUnknown ? 'UNKNOWN' : 'WATCH'
}

/**
 * 排序键。**这是证据强度，不是预测销量** ——
 * 先按通过的闸数，同数再按已售量。刻意不做成 0–100 分：
 * 那个精度我们的数据支撑不了，做出来只会被当成预测读。
 */
function evidenceRankOf(gates: readonly GateResult[], sold: number | null): number {
  const passCount = gates.filter((g) => g.outcome === 'PASS').length
  return passCount * 1_000_000 + Math.min(sold ?? 0, 999_999)
}

export function scoreCandidate(candidate: ProductCandidate): ScoredCandidate {
  const gates: readonly GateResult[] = [
    gateProvenDemand(candidate),
    gateAuNzSearched(candidate.demand),
    gateNotDeclining(candidate.demand),
    gateMargin(candidate),
  ]
  return {
    candidate,
    gates,
    verdict: decideVerdict(gates),
    evidenceRank: evidenceRankOf(gates, candidate.cumulativeSold.value),
  }
}

/** 批量打分并按证据强度降序。 */
export function rankCandidates(
  candidates: readonly ProductCandidate[],
): readonly ScoredCandidate[] {
  return candidates
    .map(scoreCandidate)
    .sort((a, b) => b.evidenceRank - a.evidenceRank)
}
