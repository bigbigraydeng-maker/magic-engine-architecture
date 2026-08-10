/**
 * Magic Engine 2.0 · GEO Measurement 契约 —— 可比性判定（Issue #876 / WP02）
 *
 * 🔴 **纯函数。** 不落库、不调用 provider、不做趋势判断。三条判据全部在
 *    GEO 契约 §6.1 冻结，本文件只是把文字判据翻成机器判定。
 *
 * 🔴 v1 冻结（Build Control Room 2026-08-10 WP02 实施授权裁定）：
 *    每条质量阈值**独立**施加于两侧队列，不平均、不许一侧补偿另一侧
 *    （对应 GEO 契约 §6.3 冻结第1条的精神）。质量阈值只裁决第3条，
 *    永远不放宽身份相等性，也永远不合并不匹配的队列。
 */

import {
  GEO_COMPARABILITY_POLICY_V1,
  type GeoAcquisitionIdentity,
  type GeoComparabilityCohortInput,
  type GeoComparabilityMismatch,
  type GeoComparabilityPolicy,
  type GeoComparabilityResult,
  type GeoInterpretationIdentity,
  type GeoMaybeUnknown,
} from './types'

function unwrapKnown<T>(v: GeoMaybeUnknown<T>): T | undefined {
  return v.known ? v.value : undefined
}

function sameKnownValue<T>(a: GeoMaybeUnknown<T>, b: GeoMaybeUnknown<T>): boolean {
  if (!a.known || !b.known) return false
  return a.value === b.value
}

function checkAcquisitionIdentity(
  left: GeoAcquisitionIdentity,
  right: GeoAcquisitionIdentity,
): GeoComparabilityMismatch[] {
  const mismatches: GeoComparabilityMismatch[] = []

  const scalarDims: readonly (keyof Omit<GeoAcquisitionIdentity, 'sample'>)[] = [
    'querySetVersion',
    'queryKey',
    'engineFamily',
    'modelVersion',
    'locale',
    'market',
  ]
  for (const dim of scalarDims) {
    if (!sameKnownValue(left[dim], right[dim])) {
      mismatches.push({
        condition: 'acquisition_identity',
        dimension: dim,
        reason: `"${dim}" does not match or is unknown on at least one side`,
      })
    }
  }

  // 样本计划必须一致 —— 队列/批次层的「打算问几次」。
  const leftPlan = unwrapKnown(left.sample.samplePlan)
  const rightPlan = unwrapKnown(right.sample.samplePlan)
  if (!leftPlan || !rightPlan || leftPlan.plannedCount !== rightPlan.plannedCount) {
    mismatches.push({
      condition: 'acquisition_identity',
      dimension: 'sample.samplePlan',
      reason: 'sample plan differs or is unknown on at least one side',
    })
  }

  // 两侧都必须能重建样本序号身份 —— 缺一侧就不算 matched（GEO 契约 §3.2 冻结）。
  if (!left.sample.sampleIndex.known || !right.sample.sampleIndex.known) {
    mismatches.push({
      condition: 'acquisition_identity',
      dimension: 'sample.sampleIndex',
      reason: 'replicate identity cannot be reconstructed on at least one side',
    })
  }

  return mismatches
}

function checkInterpretationIdentity(
  left: GeoInterpretationIdentity,
  right: GeoInterpretationIdentity,
): GeoComparabilityMismatch[] {
  const mismatches: GeoComparabilityMismatch[] = []

  // 冻结：两侧 parser 版本相同，或两侧都用同一个版本从不可变原始回答重新解析过 ——
  // 「重新解析」是编排层的动作，WP02 只能判定「声明的版本是否一致」，不能替编排层
  // 判定是否已重新解析；因此这里只接受「两侧已知且相同」为通过。
  if (!sameKnownValue(left.parserVersion, right.parserVersion)) {
    mismatches.push({
      condition: 'interpretation_identity',
      dimension: 'parserVersion',
      reason: 'parser version differs, is unknown, or neither side has been reparsed to a common version',
    })
  }

  if (!sameKnownValue(left.metricRulesVersion, right.metricRulesVersion)) {
    mismatches.push({
      condition: 'interpretation_identity',
      dimension: 'metricRulesVersion',
      reason: 'metric/taxonomy rules version differs or is unknown on at least one side',
    })
  }

  return mismatches
}

function checkQualitySide(
  side: 'left' | 'right',
  cohort: GeoComparabilityCohortInput,
  policy: GeoComparabilityPolicy,
): GeoComparabilityMismatch[] {
  const mismatches: GeoComparabilityMismatch[] = []

  const confidence = unwrapKnown(cohort.confidence)
  if (confidence === undefined || confidence < policy.minParserConfidence) {
    mismatches.push({
      condition: 'quality_thresholds',
      dimension: `${side}.confidence`,
      reason:
        confidence === undefined
          ? 'parser confidence is unknown'
          : `parser confidence ${confidence} is below the ${policy.minParserConfidence} floor`,
    })
  }

  const coverage = unwrapKnown(cohort.engineCoverage)
  if (coverage === undefined || coverage < policy.minEngineCoverage) {
    mismatches.push({
      condition: 'quality_thresholds',
      dimension: `${side}.engineCoverage`,
      reason:
        coverage === undefined
          ? 'engine coverage is unknown'
          : `engine coverage ${coverage} is below the ${policy.minEngineCoverage} floor`,
    })
  }

  const failureRate = unwrapKnown(cohort.failureRate)
  if (failureRate === undefined || failureRate > policy.maxFailureRate) {
    mismatches.push({
      condition: 'quality_thresholds',
      dimension: `${side}.failureRate`,
      reason:
        failureRate === undefined
          ? 'failure rate is unknown'
          : `failure rate ${failureRate} exceeds the ${policy.maxFailureRate} ceiling`,
    })
  }

  return mismatches
}

/**
 * 三条判据全部成立才 `comparable: true`（GEO 契约 §6.1）。任何一条不成立，
 * 结果是 `not_comparable`，并带上是哪一条、哪一项不成立。
 *
 * 质量阈值默认取 {@link GEO_COMPARABILITY_POLICY_V1}，独立施加于两侧，
 * 不平均、不许一侧补偿另一侧。
 */
export function evaluateGeoComparability(
  left: GeoComparabilityCohortInput,
  right: GeoComparabilityCohortInput,
  policy: GeoComparabilityPolicy = GEO_COMPARABILITY_POLICY_V1,
): GeoComparabilityResult {
  const mismatches: GeoComparabilityMismatch[] = [
    ...checkAcquisitionIdentity(left.acquisition, right.acquisition),
    ...checkInterpretationIdentity(left.interpretation, right.interpretation),
    ...checkQualitySide('left', left, policy),
    ...checkQualitySide('right', right, policy),
  ]

  return mismatches.length === 0 ? { comparable: true } : { comparable: false, mismatches }
}
