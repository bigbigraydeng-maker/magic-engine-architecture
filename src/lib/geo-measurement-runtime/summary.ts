/**
 * Magic Engine 2.0 · GEO Measurement Runtime —— 覆盖 / 终态 / 可比性输入（Issue #874 / WP04）
 *
 * 🔴 **纯函数。** 覆盖账、终态、交给 WP02 的可比性输入都从**真实观测**里算，绝不掺猜测值。
 * 🔴 WP04 **不自己判**能不能比：这里只把 `evaluateGeoComparability` 需要的字段如实备好。
 *    任何 `comparable: true` 只能从 WP02 的那个函数出来（架构测试盯着 WP04 里不许出现
 *    手写的可比结论）。
 */

import type {
  GeoBatch,
  GeoComparabilityCohortInput,
  GeoCoverageDescriptor,
  GeoMaybeUnknown,
  GeoObservation,
} from '@/lib/geo-measurement'

function distinctKnownStrings(values: readonly GeoMaybeUnknown<string>[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of values) {
    if (v.known && !seen.has(v.value)) {
      seen.add(v.value)
      out.push(v.value)
    }
  }
  return out
}

/** 计划覆盖：下单那一刻 succeeded / failed 恒为 0（还没跑），attempted 是整批的量。 */
export function buildPlannedCoverage(args: {
  engineFamily: string
  modelVersion: string
  locale: string
  market: string
  queryKeys: readonly string[]
  plannedObservationCount: number
}): GeoCoverageDescriptor {
  return {
    engines: [args.engineFamily],
    models: [args.modelVersion],
    locales: [args.locale],
    markets: [args.market],
    queryKeys: [...args.queryKeys],
    attempted: args.plannedObservationCount,
    succeeded: 0,
    failed: 0,
  }
}

/**
 * 实际覆盖：只统计**真的发起过**的观测。attempted = 观测行数，
 * succeeded + failed 必须等于 attempted（对应 WP03 的 actual_counts_add_up CHECK）。
 * 预算 / 限流提前收工造成的「计划了但没跑」由 planned 与 actual 的差体现，不伪造成失败行。
 */
export function buildActualCoverage(observations: readonly GeoObservation[]): GeoCoverageDescriptor {
  const succeeded = observations.filter((o) => o.outcome.ok).length
  return {
    engines: distinctKnownStrings(observations.map((o) => o.acquisition.engineFamily)),
    models: distinctKnownStrings(observations.map((o) => o.acquisition.modelVersion)),
    locales: distinctKnownStrings(observations.map((o) => o.acquisition.locale)),
    markets: distinctKnownStrings(observations.map((o) => o.acquisition.market)),
    queryKeys: distinctKnownStrings(observations.map((o) => o.acquisition.queryKey)),
    attempted: observations.length,
    succeeded,
    failed: observations.length - succeeded,
  }
}

/**
 * 诚实终态（授权第 5 条：completed / partial / failed 不许四舍五入）。
 * · 一条都没成功 → failed
 * · 计划全跑到且零失败 → completed
 * · 其余（部分成功 / 有失败 / 提前收工）→ partial
 */
export function deriveStatus(planned: GeoCoverageDescriptor, actual: GeoCoverageDescriptor): GeoBatch['status'] {
  if (actual.succeeded === 0) return 'failed'
  if (actual.attempted === planned.attempted && actual.failed === 0) return 'completed'
  return 'partial'
}

/** 批次级质量聚合 —— 供可比性阈值判定（parser 置信度 / 引擎覆盖率 / 失败率）。 */
export interface GeoBatchQuality {
  readonly confidence: GeoMaybeUnknown<number>
  readonly engineCoverage: GeoMaybeUnknown<number>
  readonly failureRate: GeoMaybeUnknown<number>
}

const unknownNA: GeoMaybeUnknown<number> = { known: false, reason: 'not_applicable' }

/** 从观测算批次质量：置信度取成功观测均值；覆盖率 = 成功/尝试；失败率 = 失败/尝试。 */
export function computeBatchQuality(actual: GeoCoverageDescriptor, observations: readonly GeoObservation[]): GeoBatchQuality {
  const confidences = observations
    .filter((o) => o.outcome.ok && o.confidence.known)
    .map((o) => (o.confidence.known ? o.confidence.value : 0))
  const confidence: GeoMaybeUnknown<number> =
    confidences.length > 0 ? { known: true, value: confidences.reduce((a, b) => a + b, 0) / confidences.length } : unknownNA
  const engineCoverage: GeoMaybeUnknown<number> =
    actual.attempted > 0 ? { known: true, value: actual.succeeded / actual.attempted } : unknownNA
  const failureRate: GeoMaybeUnknown<number> =
    actual.attempted > 0 ? { known: true, value: actual.failed / actual.attempted } : unknownNA
  return { confidence, engineCoverage, failureRate }
}

/**
 * 把**每一条成功观测**翻成一份可比性输入 —— 观测粒度才有真实的 sampleIndex 身份。
 * 字段全部来自已记录的观测 + 批次质量聚合，不掺任何猜测值（授权第 7 条）。
 * 失败观测不参与：它们没有可比的解释结果。
 */
export function buildComparabilityInputs(
  observations: readonly GeoObservation[],
  quality: GeoBatchQuality,
): GeoComparabilityCohortInput[] {
  return observations
    .filter((o) => o.outcome.ok)
    .map((o) => ({
      acquisition: o.acquisition,
      interpretation: o.interpretation,
      confidence: quality.confidence,
      engineCoverage: quality.engineCoverage,
      failureRate: quality.failureRate,
    }))
}
