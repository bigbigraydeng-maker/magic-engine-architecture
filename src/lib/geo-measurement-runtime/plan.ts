/**
 * Magic Engine 2.0 · GEO Measurement Runtime —— 计划校验（Issue #874 / WP04）
 *
 * 🔴 **纯函数，fail-closed。** 计划里任何 cohort 维度缺失、样本计划无效、
 *    或 planned-observation 超上限 / 无界 —— 一律在 **任何 provider 调用之前** 拒掉。
 *    授权第 2、3 条。
 */

import type { GeoFrozenPlan } from './types'

/**
 * 单个 batch 的 planned-observation 硬上限。
 *
 * 🔴 授权第 3 条：不许把整个查询集塞进一次长时 serverless 执行。一个 batch = 一个 cohort，
 *    planned = `queries.length × sampleCount`，必须**确定有界**。这个常量是治理护栏，
 *    只能改代码、不能按次调用放宽 —— 与 WP02 冻结阈值同一种「写死不许现算」的做法。
 */
export const MAX_PLANNED_OBSERVATIONS_PER_BATCH = 200

export type GeoPlanValidation =
  | { readonly ok: true; readonly plannedObservationCount: number }
  | { readonly ok: false; readonly code: string; readonly reason: string }

const fail = (code: string, reason: string): GeoPlanValidation => ({ ok: false, code, reason })

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function isPositiveInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

function isFiniteNonNegative(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

/**
 * 校验一份 {@link GeoFrozenPlan}。通过则返回确定的 planned-observation 计数。
 *
 * 🔴 cohort 身份维度（clientId / querySetId / querySetVersion / engineFamily /
 *    modelVersion / locale / market）任一为空 → fail closed。
 * 🔴 sampleCount 必须是显式正整数（无隐藏默认）。
 * 🔴 queries 非空、每条 queryKey/questionText 非空、queryKey 在批内唯一。
 * 🔴 planned = queries.length × sampleCount，必须 ≥1 且 ≤ 上限。
 * 🔴 预算与成本上界必须是有限非负数；重试上限必须是正整数。
 */
export function validateFrozenPlan(plan: unknown): GeoPlanValidation {
  if (typeof plan !== 'object' || plan === null) return fail('plan_not_object', 'plan must be an object')
  const p = plan as Partial<GeoFrozenPlan>

  const cohortDims: readonly (keyof GeoFrozenPlan)[] = [
    'clientId',
    'querySetId',
    'querySetVersion',
    'engineFamily',
    'modelVersion',
    'locale',
    'market',
  ]
  for (const dim of cohortDims) {
    if (!isNonEmptyString(p[dim])) {
      return fail('missing_cohort_dimension', `cohort dimension "${dim}" must be a non-empty string`)
    }
  }

  if (!isNonEmptyString(p.parserVersion)) return fail('missing_parser_version', 'parserVersion must be a non-empty string')
  if (!isNonEmptyString(p.metricRulesVersion)) {
    return fail('missing_metric_rules_version', 'metricRulesVersion must be a non-empty string')
  }

  if (!isPositiveInteger(p.sampleCount)) {
    return fail('invalid_sample_count', 'sampleCount must be an explicit positive integer (no default sample plan)')
  }

  if (!Array.isArray(p.queries) || p.queries.length === 0) {
    return fail('empty_query_scope', 'queries must be a non-empty array (query scope must be explicit)')
  }
  const seen = new Set<string>()
  for (let i = 0; i < p.queries.length; i++) {
    const q = p.queries[i]
    if (typeof q !== 'object' || q === null) return fail('invalid_query', `queries[${i}] must be an object`)
    if (!isNonEmptyString(q.queryKey)) return fail('invalid_query', `queries[${i}].queryKey must be a non-empty string`)
    if (!isNonEmptyString(q.questionText)) {
      return fail('invalid_query', `queries[${i}].questionText must be a non-empty string`)
    }
    if (seen.has(q.queryKey)) return fail('duplicate_query_key', `queries[${i}].queryKey "${q.queryKey}" is duplicated`)
    seen.add(q.queryKey)
  }

  if (!isFiniteNonNegative(p.budgetUsd)) return fail('invalid_budget', 'budgetUsd must be a finite non-negative number')
  if (!isFiniteNonNegative(p.perObservationCostCeilingUsd)) {
    return fail('invalid_cost_ceiling', 'perObservationCostCeilingUsd must be a finite non-negative number')
  }
  if (!isPositiveInteger(p.maxAttemptsPerObservation)) {
    return fail('invalid_max_attempts', 'maxAttemptsPerObservation must be a positive integer')
  }

  const plannedObservationCount = p.queries.length * p.sampleCount
  if (plannedObservationCount > MAX_PLANNED_OBSERVATIONS_PER_BATCH) {
    return fail(
      'plan_exceeds_bound',
      `planned observation count ${plannedObservationCount} exceeds the per-batch bound ${MAX_PLANNED_OBSERVATIONS_PER_BATCH}`,
    )
  }

  return { ok: true, plannedObservationCount }
}
