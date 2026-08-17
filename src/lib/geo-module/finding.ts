/**
 * Magic Engine 2.0 · GEO Module v1 —— 聚合护栏 + Finding 构建（Issue #879 / WP05）
 *
 * 🔴 纯函数。落地 M1 §7 的聚合护栏：
 *    - query 级结论**先于**聚合覆盖（先按 query 判，再数 query）；
 *    - 品牌 / 通用可分；locale 不混池（按 `query_key` 分组，天然不把中文英文并成一条）；
 *    - 一个 query 对合格提及至多计一次（§3 末段）；
 *    - **绝不把「12/12 带引用」重述成提及 / 推荐覆盖**（§7 第 5 条）——
 *      本模块的聚合里根本没有 citation 覆盖字段。
 *    - owned citation ≠ mention 的代理（§7 第 6 条）—— citation_only 在 §3 已判非提及。
 */

import type { DiagnosticSeverity } from '@/types/diagnostic'
import type { GrowthEvidence, GrowthFinding } from '@/lib/growth'
import {
  GEO_M1_RULE_VERSION,
  type GeoCoverageSummary,
  type GeoObservationInterpretation,
  type GeoQueryOutcome,
} from './types'

/**
 * 本 Finding 的稳定血缘引用（写进 `PageOptimizationRequest.lineage.findingRefs`）。
 *
 * 🔴 `GrowthFinding` 契约里没有 id 字段（WP01 刻意用结构包含而非 id 引用）。
 *    WP05 需要一个能指回 finding 的稳定串给 Page 契约的 `findingRefs` 用 —— 这就是它。
 *    v1 只有这一种 finding，用确定性 slug；语义变了就换串。
 */
export const GEO_QUALIFIED_MENTION_FINDING_REF = `${GEO_M1_RULE_VERSION}:ai_visibility:qualified_mention_coverage`

/**
 * 把观测级解释聚合成 query 级覆盖账（M1 §7）。
 *
 * 🔴 按 `query_key` 分组；`query_key` 未知的观测**各自成组**，绝不与别人并池
 *    （未知不是「同一个 query」）。
 */
export function summarizeCoverage(
  interpretations: readonly GeoObservationInterpretation[],
): GeoCoverageSummary {
  const groups = new Map<string, GeoObservationInterpretation[]>()
  for (const it of interpretations) {
    const key = groupKeyOf(it)
    const bucket = groups.get(key)
    if (bucket) bucket.push(it)
    else groups.set(key, [it])
  }

  const perQuery: GeoQueryOutcome[] = []
  for (const bucket of Array.from(groups.values())) {
    const head = bucket[0]
    const deferredCount = bucket.filter((it) => it.disposition === 'defer').length
    perQuery.push({
      queryKey: head.queryKey,
      locale: head.locale,
      market: head.market,
      branded: head.branded,
      // 一个 query 至多计一次（§3 末段）：任一样本合格提及即该 query 计一次。
      hasQualifiedMention: bucket.some((it) => it.qualifiedMention.qualified),
      hasExplicitPositive: bucket.some((it) => it.recommendation === 'explicit_positive'),
      hasConditional: bucket.some((it) => it.recommendation === 'conditional'),
      observationCount: bucket.length,
      deferredCount,
    })
  }

  const fullyDeferredQueries = perQuery.filter((q) => q.deferredCount === q.observationCount).length
  return {
    ruleVersion: GEO_M1_RULE_VERSION,
    queryCount: perQuery.length,
    interpretableQueries: perQuery.length - fullyDeferredQueries,
    qualifiedMentionQueries: perQuery.filter((q) => q.hasQualifiedMention).length,
    explicitPositiveQueries: perQuery.filter((q) => q.hasExplicitPositive).length,
    conditionalQueries: perQuery.filter((q) => q.hasConditional).length,
    fullyDeferredQueries,
    perQuery,
  }
}

/**
 * 分组键（M1 §7：query 级先于聚合、locale 不混池）。
 *
 * 🔴 采集身份把 locale / market 视为独立维度。同一 `query_key` 不同 locale / market 的观测
 *    **不得并池**（否则「英文未提及 + 中文提及」会汇成一条「英文已提及」）。
 * 🔴 任一维度未知（query_key / locale / market）→ 该观测**各自成组**：未知值也必须保持隔离，
 *    不能假设两个「未知 locale」是同一个。
 */
function groupKeyOf(it: GeoObservationInterpretation): string {
  if (!it.queryKey.known || !it.locale.known || !it.market.known) {
    return JSON.stringify(['iso', it.observationId])
  }
  // 🔴 用 JSON.stringify 编码，**不用 `|` 拼接**：三个值都来自数据面，裸拼分隔符可被
  //    构造出碰撞（locale=`x`,market=`y|m:z` 与 locale=`x|m:y`,market=`z` 拼出同一串）
  //    → 同租户内跨 locale/market 错误并池，恰是本函数硬承诺要防的事。JSON 编码不可碰撞。
  return JSON.stringify(['q', it.queryKey.value, it.locale.value, it.market.value])
}

/**
 * 是否存在 AI 可见度缺口（M1：finding = 问题 / 机会，没缺口就不该产出 finding）。
 *
 * 🔴 只在有**可解释** query 且其中存在「未合格提及」或「未获显式正向推荐」时才算有缺口。
 *    可解释 query 为 0（全 defer / 无 query）→ 无法断言缺口，返回 false（走 defer，不硬判）。
 *    全部可解释 query 都已合格提及且都 explicit_positive → 无缺口，不产出 finding。
 */
export function hasVisibilityGap(summary: GeoCoverageSummary): boolean {
  if (summary.interpretableQueries === 0) return false
  const mentionGap = summary.qualifiedMentionQueries < summary.interpretableQueries
  const recommendationGap = summary.explicitPositiveQueries < summary.interpretableQueries
  return mentionGap || recommendationGap
}

/**
 * 从覆盖账 + 证据构建一条 AI 可见度 Finding。
 *
 * 🔴 `evidence` **至少一条**（WP01 §5.2 红线：指不回证据的 Finding 不许存在）。
 * 🔴 **无缺口不产出**：可解释覆盖已满（全提及 + 全 explicit_positive）或无可解释样本时返回 `null`
 *    —— finding 是问题 / 机会，凭空产出一条「其实没缺口」的发现会驱动错误处方（Codex #1032 P1）。
 *    调用方据 `null` 走 no_gap / defer。
 */
export function buildQualifiedMentionFinding(
  summary: GeoCoverageSummary,
  evidence: readonly GrowthEvidence[],
): GrowthFinding | null {
  if (evidence.length === 0) return null
  if (!hasVisibilityGap(summary)) return null
  return {
    pillar: 'ai_visibility',
    severity: severityOf(summary),
    statement: buildStatement(summary),
    evidence,
  }
}

/**
 * 严重度：合格提及覆盖为 0 = 高（AI 答案里根本没被作为人 / 选项提及）；
 * 有一定覆盖但偏低 = 中；覆盖较好 = 低。
 *
 * 🔴 分母只用**可解释** query（`interpretableQueries`），不用 `queryCount`：完全 defer 的 query
 *    是「判不准」不是「未提及」，混进分母会仅因数据缺失就抬高严重度、驱动错误处方
 *    （Codex #1032 P1）。可解释 query 为 0（全 defer）→ `info`，绝不 high。
 */
function severityOf(summary: GeoCoverageSummary): DiagnosticSeverity {
  if (summary.interpretableQueries === 0) return 'info'
  if (summary.qualifiedMentionQueries === 0) return 'high'
  const ratio = summary.qualifiedMentionQueries / summary.interpretableQueries
  if (ratio < 0.5) return 'medium'
  return 'low'
}

/**
 * Finding 陈述 —— 说清「提及 ≠ 引用」，并把 defer 的 query 数一起报（覆盖率配样本量读）。
 */
function buildStatement(summary: GeoCoverageSummary): string {
  return (
    `按 ${GEO_M1_RULE_VERSION}：` +
    `在 ${summary.queryCount} 个 query 里，Roman 被 AI 答案正文合格提及的有 ` +
    `${summary.qualifiedMentionQueries} 个，明确正向推荐（explicit_positive）的有 ` +
    `${summary.explicitPositiveQueries} 个（另有 ${summary.conditionalQueries} 个为有条件推荐，单独计）。` +
    `其中 ${summary.fullyDeferredQueries} 个 query 的样本全部证据不足、判为 defer。` +
    `合格提及要求出现在答案正文并语义参与；引用 / 来源里出现、owned 域名被引用都不算提及。`
  )
}
