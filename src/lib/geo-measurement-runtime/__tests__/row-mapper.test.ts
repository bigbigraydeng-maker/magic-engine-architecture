/**
 * domain → WP03 行映射（Issue #874 / WP04）。
 *
 * 🔴 判据盯的是**真实写入必然要面对**的那几件事：双列 XOR、client_id / query_set_id 的
 *    落点、样本计划只落 plannedCount、`source_observation_id` 恒 null、
 *    原始响应逐字保留、定位符与正文同生共死。
 */

import { describe, it, expect } from 'vitest'
import type { GeoBatch, GeoEvidence, GeoObservation } from '@/lib/geo-measurement'
import { deriveRawResponseLocator, splitMaybe, toGeoBatchRow, toGeoEvidenceRow, toGeoObservationRow } from '../row-mapper'

const AT = '2026-08-12T00:00:00.000Z'

const acquisition: GeoObservation['acquisition'] = {
  querySetVersion: { known: true, value: 'v1' },
  queryKey: { known: true, value: 'q1' },
  engineFamily: { known: true, value: 'openai' },
  modelVersion: { known: true, value: 'gpt-4o-search-preview' },
  locale: { known: true, value: 'en-NZ' },
  market: { known: false, reason: 'not_recorded_by_source' },
  sample: {
    samplePlan: { known: true, value: { plannedCount: 3 } },
    sampleIndex: { known: true, value: 2 },
    samplingParameters: { known: true, value: { temperature: 0 } },
  },
}

const interpretation: GeoObservation['interpretation'] = {
  parserVersion: { known: true, value: 'p1' },
  metricRulesVersion: { known: false, reason: 'not_applicable' },
}

describe('splitMaybe', () => {
  it('已知 → 值列有值、理由列为空', () => {
    expect(splitMaybe({ known: true, value: 'x' })).toEqual({ value: 'x', reason: null })
  })
  it('未知 → 值列为空、理由列有值', () => {
    expect(splitMaybe({ known: false, reason: 'source_ambiguous' })).toEqual({ value: null, reason: 'source_ambiguous' })
  })
})

describe('deriveRawResponseLocator', () => {
  it('有正文 → 逐字复刻库里 GENERATED 那条表达式', () => {
    expect(deriveRawResponseLocator('e1', 'hello')).toBe('db://public.geo_evidence/e1/raw_response')
  })
  it('无正文 → null（不是指向空气的地址）', () => {
    expect(deriveRawResponseLocator('e1', null)).toBeNull()
  })
})

describe('toGeoBatchRow', () => {
  const cov = { engines: ['openai'], models: ['m'], locales: ['en-NZ'], markets: ['nz'], queryKeys: ['q1'], attempted: 1, succeeded: 1, failed: 0 }
  const batch: GeoBatch = {
    batchId: 'b1',
    querySetVersion: 'v1',
    startedAt: AT,
    completedAt: { known: true, value: AT },
    status: 'partial',
    plannedCoverage: cov,
    actualCoverage: cov,
    costUsd: { known: false, reason: 'source_ambiguous' },
    triggeredBy: { known: true, value: 'cron' },
  }

  it('client_id / query_set_id 落到行上；状态与覆盖照搬', () => {
    const row = toGeoBatchRow({ batch, clientId: 'c1', querySetId: 'qs1', createdAt: AT })
    expect(row.id).toBe('b1')
    expect(row.client_id).toBe('c1')
    expect(row.query_set_id).toBe('qs1')
    expect(row.status).toBe('partial')
    expect(row.planned_coverage).toEqual(cov)
  })

  it('成本未知 → 值列 null、理由列有值（num_nonnulls = 1）', () => {
    const row = toGeoBatchRow({ batch, clientId: 'c1', querySetId: 'qs1', createdAt: AT })
    expect(row.cost_usd).toBeNull()
    expect(row.cost_usd_unknown_reason).toBe('source_ambiguous')
    expect(row.triggered_by).toBe('cron')
    expect(row.triggered_by_unknown_reason).toBeNull()
  })
})

describe('toGeoObservationRow', () => {
  const success: GeoObservation = {
    observationId: 'o1',
    batchId: 'b1',
    acquisition,
    interpretation,
    confidence: { known: true, value: 0.9 },
    observedAt: AT,
    outcome: { ok: true, evidenceId: 'e1' },
  }

  it('七项采集身份逐项映射，已知/未知各占一列', () => {
    const row = toGeoObservationRow({ observation: success, clientId: 'c1', createdAt: AT })
    expect(row.query_set_version).toBe('v1')
    expect(row.query_set_version_unknown_reason).toBeNull()
    expect(row.market).toBeNull()
    expect(row.market_unknown_reason).toBe('not_recorded_by_source')
    expect(row.metric_rules_version).toBeNull()
    expect(row.metric_rules_version_unknown_reason).toBe('not_applicable')
  })

  it('样本计划只落 plannedCount 这一个整数列', () => {
    const row = toGeoObservationRow({ observation: success, clientId: 'c1', createdAt: AT })
    expect(row.sample_planned_count).toBe(3)
    expect(row.sample_index).toBe(2)
    expect(row.sampling_parameters).toEqual({ temperature: 0 })
    expect(row.sampling_parameters_unknown_reason).toBeNull()
  })

  it('成功 → outcome_ok=true 且三个错误列全空', () => {
    const row = toGeoObservationRow({ observation: success, clientId: 'c1', createdAt: AT })
    expect(row.outcome_ok).toBe(true)
    expect(row.error_code).toBeNull()
    expect(row.error_message).toBeNull()
    expect(row.error_message_unknown_reason).toBeNull()
  })

  it('失败 → outcome_ok=false 且必带 error_code', () => {
    const failed: GeoObservation = {
      ...success,
      confidence: { known: false, reason: 'not_applicable' },
      outcome: { ok: false, errorCode: 'rate_limited', errorMessage: { known: true, value: '429' } },
    }
    const row = toGeoObservationRow({ observation: failed, clientId: 'c1', createdAt: AT })
    expect(row.outcome_ok).toBe(false)
    expect(row.error_code).toBe('rate_limited')
    expect(row.error_message).toBe('429')
    expect(row.error_message_unknown_reason).toBeNull()
    expect(row.confidence).toBeNull()
    expect(row.confidence_unknown_reason).toBe('not_applicable')
  })

  it('正常采集的 source_observation_id 恒为 null', () => {
    const row = toGeoObservationRow({ observation: success, clientId: 'c1', createdAt: AT })
    expect(row.source_observation_id).toBeNull()
  })
})

describe('toGeoEvidenceRow', () => {
  const evidence: GeoEvidence = {
    evidenceId: 'e1',
    observationId: 'o1',
    rawResponseLocator: { known: true, value: 'db://public.geo_evidence/e1/raw_response' },
    citations: [
      {
        url: 'https://example.com/a',
        domain: 'example.com',
        ownedDomain: { known: false, reason: 'not_recorded_by_source' },
        ownedPage: { status: 'not_computable', reason: 'no page ledger' },
      },
    ],
  }

  it('原始响应逐字保留，定位符按库里的表达式推导', () => {
    const row = toGeoEvidenceRow({ evidence, rawResponse: { known: true, value: 'hello world' }, clientId: 'c1', createdAt: AT })
    expect(row.raw_response).toBe('hello world')
    expect(row.raw_response_unknown_reason).toBeNull()
    expect(row.raw_response_locator).toBe('db://public.geo_evidence/e1/raw_response')
    expect(row.client_id).toBe('c1')
    expect(row.observation_id).toBe('o1')
  })

  it('原文未知 → 定位符也为 null（不留指向空气的地址）', () => {
    const row = toGeoEvidenceRow({
      evidence,
      rawResponse: { known: false, reason: 'not_recorded_by_source' },
      clientId: 'c1',
      createdAt: AT,
    })
    expect(row.raw_response).toBeNull()
    expect(row.raw_response_unknown_reason).toBe('not_recorded_by_source')
    expect(row.raw_response_locator).toBeNull()
  })

  it('引用来源逐字保留 ownedDomain / ownedPage 的显式形态', () => {
    const row = toGeoEvidenceRow({ evidence, rawResponse: { known: true, value: 'x' }, clientId: 'c1', createdAt: AT })
    expect(row.citations).toEqual([
      {
        url: 'https://example.com/a',
        domain: 'example.com',
        ownedDomain: { known: false, reason: 'not_recorded_by_source' },
        ownedPage: { status: 'not_computable', reason: 'no page ledger' },
      },
    ])
  })
})
