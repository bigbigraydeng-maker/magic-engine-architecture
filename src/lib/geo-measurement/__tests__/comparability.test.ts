/**
 * GEO Measurement 契约 —— 可比性判定守卫（Issue #876 / WP02）
 *
 * 每一条断言指向 GEO 测量契约 v1.0 §6 的一条冻结判据。
 */

import { describe, it, expect } from 'vitest'
import { evaluateGeoComparability } from '../comparability'
import { GEO_COMPARABILITY_POLICY_V1 } from '../types'
import type { GeoAcquisitionIdentity, GeoComparabilityCohortInput, GeoInterpretationIdentity } from '../types'

const acquisition = (overrides: Partial<GeoAcquisitionIdentity> = {}): GeoAcquisitionIdentity => ({
  querySetVersion: { known: true, value: 'roman-nz-geo-v1' },
  queryKey: { known: true, value: 'best_migration_agent_auckland' },
  engineFamily: { known: true, value: 'chatgpt' },
  modelVersion: { known: true, value: 'gpt-4o-2026-06' },
  locale: { known: true, value: 'en-NZ' },
  market: { known: true, value: 'nz' },
  sample: {
    samplePlan: { known: true, value: { plannedCount: 3 } },
    sampleIndex: { known: true, value: 1 },
    samplingParameters: { known: false, reason: 'not_recorded_by_source' },
  },
  ...overrides,
})

const interpretation = (overrides: Partial<GeoInterpretationIdentity> = {}): GeoInterpretationIdentity => ({
  parserVersion: { known: true, value: 'geo-parser@2026-08-01' },
  metricRulesVersion: { known: true, value: 'geo-rules@2026-08-01' },
  ...overrides,
})

const cohort = (overrides: Partial<GeoComparabilityCohortInput> = {}): GeoComparabilityCohortInput => ({
  acquisition: acquisition(),
  interpretation: interpretation(),
  confidence: { known: true, value: 0.9 },
  engineCoverage: { known: true, value: 0.9 },
  failureRate: { known: true, value: 0.05 },
  ...overrides,
})

describe('evaluateGeoComparability', () => {
  it('两侧完全一致且都过质量阈值 → comparable', () => {
    expect(evaluateGeoComparability(cohort(), cohort())).toEqual({ comparable: true })
  })

  it('v1 冻结阈值：0.80 confidence / 0.80 coverage / 0.20 failure rate', () => {
    expect(GEO_COMPARABILITY_POLICY_V1).toEqual({
      version: 'v1',
      minParserConfidence: 0.8,
      minEngineCoverage: 0.8,
      maxFailureRate: 0.2,
    })
  })

  it('采集身份任一项不同 → not_comparable，且原因点名该维度', () => {
    const result = evaluateGeoComparability(
      cohort(),
      cohort({ acquisition: acquisition({ market: { known: true, value: 'au' } }) }),
    )
    expect(result.comparable).toBe(false)
    if (result.comparable) throw new Error('unreachable')
    expect(result.mismatches.some((m) => m.condition === 'acquisition_identity' && m.dimension === 'market')).toBe(
      true,
    )
  })

  it('样本计划数量不同 → not_comparable', () => {
    const result = evaluateGeoComparability(
      cohort(),
      cohort({
        acquisition: acquisition({
          sample: { ...acquisition().sample, samplePlan: { known: true, value: { plannedCount: 5 } } },
        }),
      }),
    )
    expect(result.comparable).toBe(false)
  })

  it('任一侧无法重建样本序号身份 → not_comparable（GEO 契约 §3.2 冻结）', () => {
    const result = evaluateGeoComparability(
      cohort(),
      cohort({
        acquisition: acquisition({
          sample: {
            ...acquisition().sample,
            sampleIndex: { known: false, reason: 'not_recorded_by_source' },
          },
        }),
      }),
    )
    expect(result.comparable).toBe(false)
    if (result.comparable) throw new Error('unreachable')
    expect(result.mismatches.some((m) => m.dimension === 'sample.sampleIndex')).toBe(true)
  })

  it('parser 版本不一致 → not_comparable，原因点名 interpretation_identity', () => {
    const result = evaluateGeoComparability(
      cohort(),
      cohort({ interpretation: interpretation({ parserVersion: { known: true, value: 'geo-parser@2026-09-01' } }) }),
    )
    expect(result.comparable).toBe(false)
    if (result.comparable) throw new Error('unreachable')
    expect(
      result.mismatches.some((m) => m.condition === 'interpretation_identity' && m.dimension === 'parserVersion'),
    ).toBe(true)
  })

  it('metricRulesVersion 不一致 → not_comparable', () => {
    const result = evaluateGeoComparability(
      cohort(),
      cohort({ interpretation: interpretation({ metricRulesVersion: { known: true, value: 'geo-rules@2026-09-01' } }) }),
    )
    expect(result.comparable).toBe(false)
  })

  it('一侧置信度低于阈值 → not_comparable，且不因另一侧高置信度被平均掉', () => {
    const result = evaluateGeoComparability(cohort({ confidence: { known: true, value: 0.5 } }), cohort())
    expect(result.comparable).toBe(false)
    if (result.comparable) throw new Error('unreachable')
    expect(result.mismatches.some((m) => m.dimension === 'left.confidence')).toBe(true)
    // 右侧没有被左侧拖累 —— 两侧独立判定。
    expect(result.mismatches.some((m) => m.dimension === 'right.confidence')).toBe(false)
  })

  it('一侧引擎覆盖率低于阈值 → not_comparable', () => {
    const result = evaluateGeoComparability(cohort(), cohort({ engineCoverage: { known: true, value: 0.5 } }))
    expect(result.comparable).toBe(false)
    if (result.comparable) throw new Error('unreachable')
    expect(result.mismatches.some((m) => m.dimension === 'right.engineCoverage')).toBe(true)
  })

  it('一侧失败率超过上限 → not_comparable', () => {
    const result = evaluateGeoComparability(cohort({ failureRate: { known: true, value: 0.5 } }), cohort())
    expect(result.comparable).toBe(false)
    if (result.comparable) throw new Error('unreachable')
    expect(result.mismatches.some((m) => m.dimension === 'left.failureRate')).toBe(true)
  })

  it('质量信号未知时按不达标处理，不许当成「跳过检查」', () => {
    const result = evaluateGeoComparability(
      cohort({ confidence: { known: false, reason: 'not_recorded_by_source' } }),
      cohort(),
    )
    expect(result.comparable).toBe(false)
  })

  it('高置信度不会让身份不匹配的两侧变得可比 —— 置信度只裁决第3条', () => {
    const result = evaluateGeoComparability(
      cohort({ confidence: { known: true, value: 0.99 } }),
      cohort({
        acquisition: acquisition({ engineFamily: { known: true, value: 'perplexity' } }),
        confidence: { known: true, value: 0.99 },
      }),
    )
    expect(result.comparable).toBe(false)
    if (result.comparable) throw new Error('unreachable')
    expect(result.mismatches.every((m) => m.condition !== 'quality_thresholds')).toBe(true)
  })

  it('可以显式传入自定义阈值策略（例如更严格的 WP08 覆盖）', () => {
    const strict = { version: 'strict-test', minParserConfidence: 0.99, minEngineCoverage: 0.99, maxFailureRate: 0.01 }
    const result = evaluateGeoComparability(cohort(), cohort(), strict)
    expect(result.comparable).toBe(false)
  })
})
