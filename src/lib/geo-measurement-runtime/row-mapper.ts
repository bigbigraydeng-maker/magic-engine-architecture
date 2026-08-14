/**
 * Magic Engine 2.0 · GEO Measurement Runtime —— domain → WP03 行映射（Issue #874 / WP04）
 *
 * 🔴 **纯函数。** 把 WP02 契约对象翻成 WP03 的行形状（`@/lib/geo-measurement-store`）。
 *    没有 supabase 客户端、不发一条 SQL —— 真实写入是后续单独授权的步骤。
 *
 * 🔴 **复用 WP03 的行类型，不另立一套。** 每一对 `<field>` / `<field>_unknown_reason`
 *    恰好一个非空（库层 `num_nonnulls(...) = 1` 强制），这里的 {@link splitMaybe}
 *    就是那条约束的唯一翻译点 —— 二十来个字段各写一遍必然有一处漏改。
 *
 * 🔴 `raw_response_locator` 是库里的 `GENERATED ALWAYS AS ... STORED` 列，**写入方给它
 *    赋值会被 Postgres 拒绝**。这里照库里那条表达式**推导**出来，是为了让假 store 能
 *    验证「定位符必须有真实原文兜底」；真实 store 绝不能把它放进 INSERT 的列清单。
 */

import type {
  GeoBatch,
  GeoEvidence,
  GeoJsonValue,
  GeoMaybeUnknown,
  GeoObservation,
} from '@/lib/geo-measurement'
import type {
  GeoBatchRow,
  GeoEvidenceRow,
  GeoObservationRow,
  GeoUnknownReasonColumn,
} from '@/lib/geo-measurement-store/types'

/** 一对「已知值列 / 未知理由列」。恰好一个非空。 */
interface SplitColumns<T> {
  readonly value: T | null
  readonly reason: GeoUnknownReasonColumn
}

/** `GeoMaybeUnknown<T>` → 库里那对双列。这是 `num_nonnulls(...) = 1` 的唯一翻译点。 */
export function splitMaybe<T>(maybe: GeoMaybeUnknown<T>): SplitColumns<T> {
  return maybe.known ? { value: maybe.value, reason: null } : { value: null, reason: maybe.reason }
}

/**
 * 库里 `geo_evidence.raw_response_locator` 那条 GENERATED 表达式的逐字复刻。
 * 原始响应记未知时是 NULL —— 不是一个指向空气的地址。
 */
export function deriveRawResponseLocator(evidenceId: string, rawResponse: string | null): string | null {
  return rawResponse !== null ? `db://public.geo_evidence/${evidenceId}/raw_response` : null
}

export function toGeoBatchRow(args: {
  batch: GeoBatch
  clientId: string
  querySetId: string
  createdAt: string
}): GeoBatchRow {
  const completedAt = splitMaybe(args.batch.completedAt)
  const cost = splitMaybe(args.batch.costUsd)
  const triggeredBy = splitMaybe(args.batch.triggeredBy)
  return {
    id: args.batch.batchId,
    client_id: args.clientId,
    query_set_id: args.querySetId,
    started_at: args.batch.startedAt,
    completed_at: completedAt.value,
    completed_at_unknown_reason: completedAt.reason,
    status: args.batch.status,
    // 形状与 WP02 的 GeoCoverageDescriptor 一一对应；库层 CHECK 盯着八个键齐全。
    planned_coverage: { ...args.batch.plannedCoverage },
    actual_coverage: { ...args.batch.actualCoverage },
    cost_usd: cost.value,
    cost_usd_unknown_reason: cost.reason,
    triggered_by: triggeredBy.value,
    triggered_by_unknown_reason: triggeredBy.reason,
    created_at: args.createdAt,
  }
}

export function toGeoObservationRow(args: {
  observation: GeoObservation
  clientId: string
  createdAt: string
}): GeoObservationRow {
  const o = args.observation
  const a = o.acquisition
  const querySetVersion = splitMaybe(a.querySetVersion)
  const queryKey = splitMaybe(a.queryKey)
  const engineFamily = splitMaybe(a.engineFamily)
  const modelVersion = splitMaybe(a.modelVersion)
  const locale = splitMaybe(a.locale)
  const market = splitMaybe(a.market)
  const samplePlan = splitMaybe(a.sample.samplePlan)
  const sampleIndex = splitMaybe(a.sample.sampleIndex)
  const samplingParameters = splitMaybe(a.sample.samplingParameters)
  const parserVersion = splitMaybe(o.interpretation.parserVersion)
  const metricRulesVersion = splitMaybe(o.interpretation.metricRulesVersion)
  const confidence = splitMaybe(o.confidence)

  // 失败必须有机器可读的码，成功不许有（库层 geo_obs_error_code_matches_outcome）。
  const errorMessage = o.outcome.ok
    ? { value: null, reason: null }
    : splitMaybe<string>(o.outcome.errorMessage)

  return {
    id: o.observationId,
    client_id: args.clientId,
    batch_id: o.batchId,

    query_set_version: querySetVersion.value,
    query_set_version_unknown_reason: querySetVersion.reason,
    query_key: queryKey.value,
    query_key_unknown_reason: queryKey.reason,
    engine_family: engineFamily.value,
    engine_family_unknown_reason: engineFamily.reason,
    model_version: modelVersion.value,
    model_version_unknown_reason: modelVersion.reason,
    locale: locale.value,
    locale_unknown_reason: locale.reason,
    market: market.value,
    market_unknown_reason: market.reason,
    // 样本计划在库里只落 plannedCount 这一个整数列。
    sample_planned_count: samplePlan.value === null ? null : samplePlan.value.plannedCount,
    sample_planned_count_unknown_reason: samplePlan.reason,
    sample_index: sampleIndex.value,
    sample_index_unknown_reason: sampleIndex.reason,
    sampling_parameters: samplingParameters.value === null ? null : { ...samplingParameters.value },
    sampling_parameters_unknown_reason: samplingParameters.reason,

    parser_version: parserVersion.value,
    parser_version_unknown_reason: parserVersion.reason,
    metric_rules_version: metricRulesVersion.value,
    metric_rules_version_unknown_reason: metricRulesVersion.reason,

    confidence: confidence.value,
    confidence_unknown_reason: confidence.reason,

    observed_at: o.observedAt,

    outcome_ok: o.outcome.ok,
    error_code: o.outcome.ok ? null : o.outcome.errorCode,
    error_message: errorMessage.value,
    error_message_unknown_reason: errorMessage.reason,

    // 🔴 正常采集恒为 null。重新解析走「新批次 + 新观测」，WP04 v1 不实现重新解析。
    source_observation_id: null,

    created_at: args.createdAt,
  }
}

export function toGeoEvidenceRow(args: {
  evidence: GeoEvidence
  rawResponse: GeoMaybeUnknown<string>
  clientId: string
  createdAt: string
}): GeoEvidenceRow {
  const raw = splitMaybe(args.rawResponse)
  return {
    id: args.evidence.evidenceId,
    client_id: args.clientId,
    observation_id: args.evidence.observationId,
    raw_response: raw.value,
    raw_response_unknown_reason: raw.reason,
    // GENERATED 列：这里推导只为让假 store 验证「定位符有真实原文兜底」。
    raw_response_locator: deriveRawResponseLocator(args.evidence.evidenceId, raw.value),
    // 逐字保留 WP02 的 GeoCitation，不规范化、不补默认。
    citations: args.evidence.citations.map((c) => ({ ...c })) as readonly unknown[],
    created_at: args.createdAt,
  }
}

/** `sampling_parameters` 的元素类型别名（供调用方标注，不参与运行时行为）。 */
export type GeoSamplingParametersJson = { readonly [key: string]: GeoJsonValue }
