/**
 * Magic Engine 2.0 · GEO Module v1 —— 证据映射（Issue #879 / WP05）
 *
 * `GeoObservationRow` / `GeoEvidenceRow`（#883 存储行） → `GrowthEvidence`（WP01 契约）。
 *
 * 🔴 纯函数、不改传入对象、不落库、不回写 #883。
 * 🔴 每一项都是 `GrowthMaybeUnknown`：**不知道就记理由，绝不补 0 / 绝不省略**
 *    （WP01 §4 / GEO 契约 §5 第 3 条）。失败观测（无证据行）同样映射得出一条证据 ——
 *    「这次观测发生过、但没读回正文」本身就是覆盖率要用的事实。
 */

import type { GeoEvidenceRow, GeoObservationRow } from '@/lib/geo-measurement-store/types'
import type { GrowthEvidence, GrowthMaybeUnknown } from '@/lib/growth'

/** 来源系统名 —— 写进 `GrowthEvidence.source.kind`。 */
export const GEO_EVIDENCE_SOURCE_KIND = 'geo_observation'

export interface GeoEvidenceInput {
  readonly observation: GeoObservationRow
  /** 与观测一一对应；失败观测传 `null`（无证据行）。 */
  readonly evidence: GeoEvidenceRow | null
}

/**
 * 把一条观测 + 其证据读成一条不可变的 `GrowthEvidence`。
 *
 * 🔴 `sourceId` 用 `observation.id`（不是 evidence.id）：血缘的锚是观测，证据行是它的附属，
 *    失败观测根本没有 evidence.id。
 */
export function toGrowthEvidence(input: GeoEvidenceInput): GrowthEvidence {
  const { observation, evidence } = input
  return {
    source: { kind: GEO_EVIDENCE_SOURCE_KIND, sourceId: observation.id },
    observedAt: observation.observed_at,
    rawLocator: rawLocatorOf(evidence),
    interpretation: interpretationOf(observation),
    confidence: confidenceOf(observation),
  }
}

function rawLocatorOf(evidence: GeoEvidenceRow | null): GrowthMaybeUnknown<string> {
  if (evidence && typeof evidence.raw_response_locator === 'string' && evidence.raw_response_locator.length > 0) {
    return { known: true, value: evidence.raw_response_locator }
  }
  // 失败观测无证据行，或原始响应记为未知 → 定位符诚实未知（不是指向空气的地址）。
  return { known: false, reason: 'not_recorded_by_source' }
}

function interpretationOf(observation: GeoObservationRow): GrowthMaybeUnknown<{ readonly parserVersion: string }> {
  if (typeof observation.parser_version === 'string' && observation.parser_version.length > 0) {
    return { known: true, value: { parserVersion: observation.parser_version } }
  }
  return { known: false, reason: mapUnknownReason(observation.parser_version_unknown_reason) }
}

function confidenceOf(observation: GeoObservationRow): GrowthMaybeUnknown<number> {
  if (typeof observation.confidence === 'number' && Number.isFinite(observation.confidence)) {
    return { known: true, value: observation.confidence }
  }
  return { known: false, reason: mapUnknownReason(observation.confidence_unknown_reason) }
}

/** WP02/03 三值未知域 → Growth 未知理由码。对不上落最保守的 `not_recorded_by_source`。 */
function mapUnknownReason(column: string | null): 'not_recorded_by_source' | 'not_applicable' | 'source_ambiguous' {
  switch (column) {
    case 'not_applicable':
      return 'not_applicable'
    case 'source_ambiguous':
      return 'source_ambiguous'
    default:
      return 'not_recorded_by_source'
  }
}
