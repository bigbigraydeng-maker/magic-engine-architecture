/**
 * 计划校验 —— cohort 身份完整性 + 有界性（Issue #874 / WP04）。
 * 授权第 2、3 条：缺 cohort 维度 / 无隐藏样本计划 / 超上限无界都必须 fail closed。
 */

import { describe, it, expect } from 'vitest'
import { validateFrozenPlan, MAX_PLANNED_OBSERVATIONS_PER_BATCH } from '../plan'
import type { GeoFrozenPlan } from '../types'

function goodPlan(over: Partial<GeoFrozenPlan> = {}): GeoFrozenPlan {
  return {
    clientId: 'client-1',
    querySetId: 'qs-1',
    querySetVersion: 'v1',
    queries: [{ queryKey: 'q1', questionText: 'best tours in NZ?' }],
    engineFamily: 'openai',
    modelVersion: 'gpt-4o-search-preview',
    locale: 'en-NZ',
    market: 'nz',
    sampleCount: 3,
    samplingParameters: { known: false, reason: 'not_recorded_by_source' },
    parserVersion: 'p1',
    metricRulesVersion: 'm1',
    budgetUsd: 10,
    perObservationCostCeilingUsd: 0.05,
    maxAttemptsPerObservation: 2,
    triggeredBy: { known: true, value: 'test' },
    ...over,
  }
}

describe('validateFrozenPlan', () => {
  it('接受一份完整的冻结计划，并给出确定的 planned-observation 计数', () => {
    const r = validateFrozenPlan(goodPlan())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.plannedObservationCount).toBe(3) // 1 query × 3 samples
  })

  const cohortDims = ['clientId', 'querySetId', 'querySetVersion', 'engineFamily', 'modelVersion', 'locale', 'market'] as const
  for (const dim of cohortDims) {
    it(`缺 cohort 维度 "${dim}" → fail closed`, () => {
      const r = validateFrozenPlan(goodPlan({ [dim]: '' } as Partial<GeoFrozenPlan>))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('missing_cohort_dimension')
    })
  }

  it('sampleCount 缺失（用默认值）不被接受 —— 没有隐藏样本计划', () => {
    const p = goodPlan()
    const withoutSample = { ...p } as Record<string, unknown>
    delete withoutSample.sampleCount
    const r = validateFrozenPlan(withoutSample)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('invalid_sample_count')
  })

  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`sampleCount=${bad} 非法 → fail closed`, () => {
      const r = validateFrozenPlan(goodPlan({ sampleCount: bad }))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('invalid_sample_count')
    })
  }

  it('空查询范围 → fail closed', () => {
    const r = validateFrozenPlan(goodPlan({ queries: [] }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('empty_query_scope')
  })

  it('重复 queryKey → fail closed', () => {
    const r = validateFrozenPlan(
      goodPlan({ queries: [{ queryKey: 'q1', questionText: 'a' }, { queryKey: 'q1', questionText: 'b' }] }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('duplicate_query_key')
  })

  it('超出 planned-observation 上限 → 拒（不许把整个查询集塞进一个 batch）', () => {
    const queries = Array.from({ length: MAX_PLANNED_OBSERVATIONS_PER_BATCH + 1 }, (_, i) => ({
      queryKey: `q${i}`,
      questionText: `question ${i}`,
    }))
    const r = validateFrozenPlan(goodPlan({ queries, sampleCount: 1 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('plan_exceeds_bound')
  })

  it('样本数把总量顶过上限也拒（有界性是 queries × samples）', () => {
    const queries = Array.from({ length: 100 }, (_, i) => ({ queryKey: `q${i}`, questionText: `q ${i}` }))
    const r = validateFrozenPlan(goodPlan({ queries, sampleCount: 3 })) // 300 > 200
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('plan_exceeds_bound')
  })

  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    it(`budgetUsd=${bad} 非法 → fail closed`, () => {
      const r = validateFrozenPlan(goodPlan({ budgetUsd: bad }))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('invalid_budget')
    })
    it(`perObservationCostCeilingUsd=${bad} 非法 → fail closed`, () => {
      const r = validateFrozenPlan(goodPlan({ perObservationCostCeilingUsd: bad }))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('invalid_cost_ceiling')
    })
  }

  it('maxAttemptsPerObservation 非正整数 → fail closed', () => {
    const r = validateFrozenPlan(goodPlan({ maxAttemptsPerObservation: 0 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('invalid_max_attempts')
  })
})
