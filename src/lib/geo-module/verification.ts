/**
 * Magic Engine 2.0 · GEO Module v1 —— 验证定义（Issue #879 / WP05）
 *
 * 在动作发生**之前**写下判据（WP01 §5.5：success / failure / indeterminate 三档缺一不可）。
 * `GrowthActionCandidate` 与 `PageOptimizationRequest` 复用同一份定义。
 *
 * 🔴 **测量层判出的 `not_comparable` 只能落 `indeterminate`，永远不许落 `failure`**
 *    （WP01 契约注释 + GEO 契约 §6.2）。这条直接写进 criteria 文本，让判据本身就带着这条约束。
 * 🔴 `metricRef` 刻意用带 rule_version 前缀的测量层引用，**不绑既有 `geo.*` 归因指标**：
 *    测量层指标与归因指标不许假定同名即同义（GEO 契约 §5 末段）。
 * 🔴 **`baselineBatchId` 必填** —— shared runtime 不再静默默认任何客户的 baseline
 *    （Magic Engine Customer Zero 真实运行证明：hidden default 会让别的客户拿到 Roman 语义）。
 */

import type { GrowthVerificationDefinition } from '@/lib/growth'
import { GEO_M1_RULE_VERSION } from './types'

/** 默认验证窗口（天）。 */
export const DEFAULT_VERIFICATION_WINDOW_DAYS = 28

/**
 * shared verification 拒绝缺 baseline 的调用（fail-closed）。
 * 只在运行时校验，配合 TS 必填字段一起用 —— 避免 js 调用方 / 序列化重建绕过类型。
 */
export class GeoBaselineRefError extends Error {
  readonly code = 'baseline_ref_invalid'
  constructor(message: string) {
    super(message)
    this.name = 'GeoBaselineRefError'
  }
}

export interface BuildVerificationInput {
  /** 对照基线批次 id —— 必填，调用方显式提供。shared runtime 无客户级默认。 */
  readonly baselineBatchId: string
  readonly windowDays?: number
}

/**
 * 构建合格提及覆盖的验证定义。
 *
 * 🔴 `metricRef` = `geo-module/m1/v1:qualified_mention_coverage` —— 与 finding 同一把测量层尺子，
 *    不重述成任何 `geo.*` 归因指标名。
 */
export function buildQualifiedMentionVerification(
  input: BuildVerificationInput,
): GrowthVerificationDefinition {
  if (input === null || typeof input !== 'object') {
    throw new GeoBaselineRefError('BuildVerificationInput 必须是对象')
  }
  if (typeof input.baselineBatchId !== 'string' || input.baselineBatchId.trim().length === 0) {
    throw new GeoBaselineRefError('baselineBatchId 必须是非空字符串 —— shared runtime 不再默认 Roman baseline')
  }
  const windowDays = input.windowDays ?? DEFAULT_VERIFICATION_WINDOW_DAYS
  return {
    metricRef: `${GEO_M1_RULE_VERSION}:qualified_mention_coverage`,
    windowDays,
    baseline: `基线批次 ${input.baselineBatchId} 在 ${GEO_M1_RULE_VERSION} 下的 query 级合格提及覆盖`,
    criteria: {
      success:
        '在同一查询集版本、同一 locale、引擎覆盖可比的前提下，' +
        'query 级合格提及覆盖相对基线上升，且 explicit_positive 覆盖不下降。',
      failure:
        '在采集身份与解释身份都可比的前提下，query 级合格提及覆盖相对基线明确下降。',
      indeterminate:
        '测量层判为 not_comparable（查询集版本 / 解析身份 / 引擎覆盖对不上，或 locale 混池），' +
        '或复测样本证据不足 —— 一律落 indeterminate，永不落 failure。',
    },
  }
}
