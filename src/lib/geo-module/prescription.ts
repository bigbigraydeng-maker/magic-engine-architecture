/**
 * Magic Engine 2.0 · GEO Module v1 —— 处方构建（Issue #879 / WP05）
 *
 * `GrowthFinding` → `GrowthPrescription`（WP01 §5.3）。纯函数。
 *
 * 🔴 `covers` 至少一条；`notDoing` 必填（可空数组但不省略）；`orderingRationale` 非空。
 * 🔴 `notDoing` 把 M1 的红线**显式写成「刻意不做」**：不推断别名、不模糊匹配、不回写基线、
 *    不把引用覆盖当提及 —— 让处方本身就带着这些约束，而不是靠读者记得。
 */

import type { GrowthFinding, GrowthPrescription } from '@/lib/growth'
import { GEO_M1_RULE_VERSION } from './types'

/**
 * 从一条 AI 可见度 finding 构建处方。
 *
 * `goalId` 允许未知（WP01 §5.3：目标可能还没建，强行要 id 会逼调用方编一个）。
 * 🔴 `canonicalDisplayName` 用于 notDoing / orderingRationale 文本模板替换
 *    （R8/R9 templated），不硬编码 `Roman`。
 */
export function buildPrescription(finding: GrowthFinding, canonicalDisplayName: string): GrowthPrescription {
  return {
    goalId: { known: false, reason: 'not_recorded_by_source' },
    covers: [finding],
    notDoing: [
      {
        statement: '不基于未判定证据推断任何别名、身份关联、域名归属或组织关系',
        reason: `${GEO_M1_RULE_VERSION} §1：brand_aliases 为空，禁止别名推断与模糊匹配`,
      },
      {
        statement: `不把「答案带引用」重述成 ${canonicalDisplayName} 被提及或被推荐`,
        reason: `${GEO_M1_RULE_VERSION} §7：引用覆盖不是提及 / 推荐覆盖的代理`,
      },
      {
        statement: '不回写或改动基线观测 / 证据 / 引用 / 解析身份',
        reason: `${GEO_M1_RULE_VERSION} §6：派生结论不得回写基线`,
      },
      {
        statement: '不在本模块内映射候选身份到 ActionKey、不授权、不进执行队列',
        reason: 'WP00 §5.4 / §8.3：Domain Module 只产候选，授权归 Kernel、映射归 K-WP02',
      },
    ],
    orderingRationale:
      `AI 可见度是 ${canonicalDisplayName} 首次诊断里证据最直接的一柱：基线显示答案普遍带引用却未建立正文合格提及，` +
      `先补「让 AI 答案真正把 ${canonicalDisplayName} 作为相关选项明确提及」的页面可答性，优先级高于其它未被证据支撑的动作。`,
  }
}
