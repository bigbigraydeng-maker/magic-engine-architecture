/**
 * Magic Engine 2.0 · GEO Module v1 —— 动作候选构建（Issue #879 / WP05）
 *
 * `GrowthFinding` → `GrowthActionCandidate`（WP01 §5.4）。纯函数。
 *
 * 🔴 候选**不是命令**：没有 risk / sideEffect / policy / approved / actionKey，
 *    身份是 `{ domain, intent }` 结构体（不是 ActionKey，也不映射到 ActionKey —— 归 K-WP02）。
 * 🔴 `input` 必须 JSON-safe（校验器查「能不能原样存活一次序列化」）。
 * 🔴 `cost`：本动作把**已给定**的 `proposedValue` 交给 WP06 diff、WP07 提交，
 *    执行路径**不调用任何付费 provider**（proposedValue 由调用方提供，不在这里生成）——
 *    所以 `spendsMoney=false`。若哪天改成模块内生成文案，必须翻成 `spendsMoney=true`
 *    并给出 `ceilingUsd` 上界，否则校验器 fail-closed 拒绝（WP00 §8.4）。
 */

import type { GrowthActionCandidate, GrowthFinding, GrowthVerificationDefinition } from '@/lib/growth'
import { GEO_M1_RULE_VERSION, type GeoCoverageSummary } from './types'

/** 候选意图 —— `{ domain:'geo', intent:'optimize_page_answerability' }`。 */
export const GEO_CANDIDATE_DOMAIN = 'geo'
export const GEO_CANDIDATE_INTENT = 'optimize_page_answerability'

export interface BuildCandidateInput {
  readonly finding: GrowthFinding
  readonly targetPageUrl: string
  readonly summary: GeoCoverageSummary
  readonly verification: GrowthVerificationDefinition
}

/**
 * 从 finding + 已解析的目标页 URL 构建候选。
 *
 * `input` 只放 JSON 安全的标量与数组 —— 目标页、规则版本、支柱、覆盖账数字。
 * 这些是 provider 中立的意图描述，不含任何 provider 专有字段名（那条语义约束由域映射层强制）。
 */
export function buildCandidate(input: BuildCandidateInput): GrowthActionCandidate {
  const { finding, targetPageUrl, summary, verification } = input
  return {
    identity: { domain: GEO_CANDIDATE_DOMAIN, intent: GEO_CANDIDATE_INTENT },
    input: {
      ruleVersion: GEO_M1_RULE_VERSION,
      pillar: 'ai_visibility',
      targetPageUrl,
      queryCount: summary.queryCount,
      qualifiedMentionQueries: summary.qualifiedMentionQueries,
      explicitPositiveQueries: summary.explicitPositiveQueries,
    },
    basis: [finding],
    expectedImpact: 'medium',
    cost: {
      spendsMoney: false,
      // 本动作执行路径不花钱（proposedValue 已给定，WP06/07 只 diff+提交）→ 上界不适用。
      ceilingUsd: { known: false, reason: 'not_applicable' },
    },
    verification,
  }
}
