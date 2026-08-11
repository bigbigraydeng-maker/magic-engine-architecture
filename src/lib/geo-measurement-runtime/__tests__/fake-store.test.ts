/**
 * 假 store 直接测：WP03 不变式的原子建模（Issue #874 / WP04）。
 * 任一不变式被违反 → 抛错且**一行都不写**。
 */

import { describe, it, expect } from 'vitest'
import { buildFailedObservation, buildSuccessObservation } from '../observation'
import { GeoFakeStore, GeoFakeStoreError } from '../fake-store'
import type { GeoBatch } from '@/lib/geo-measurement'
import type { GeoEvidenceRecord, GeoFrozenPlan } from '../types'

const plan: GeoFrozenPlan = {
  clientId: 'c1',
  querySetId: 'qs1',
  querySetVersion: 'v1',
  queries: [{ queryKey: 'q1', questionText: 'q' }],
  engineFamily: 'openai',
  modelVersion: 'm',
  locale: 'en-NZ',
  market: 'nz',
  sampleCount: 1,
  samplingParameters: { known: false, reason: 'not_applicable' },
  parserVersion: 'p1',
  metricRulesVersion: 'mr1',
  budgetUsd: 1,
  perObservationCostCeilingUsd: 0.1,
  maxAttemptsPerObservation: 1,
  triggeredBy: { known: false, reason: 'not_applicable' },
}

const emptyCoverage = {
  engines: [],
  models: [],
  locales: [],
  markets: [],
  queryKeys: [],
  attempted: 0,
  succeeded: 0,
  failed: 0,
}

function batch(over: Partial<GeoBatch> = {}): GeoBatch {
  const cov = emptyCoverage
  return {
    batchId: 'b1',
    querySetVersion: 'v1',
    startedAt: '2026-08-12T00:00:00.000Z',
    completedAt: { known: true, value: '2026-08-12T00:00:01.000Z' },
    status: 'completed',
    plannedCoverage: cov,
    actualCoverage: cov,
    costUsd: { known: true, value: 0 },
    triggeredBy: { known: false, reason: 'not_applicable' },
    ...over,
  }
}

function success(sampleIndex: number, obsId: string, eviId: string) {
  return buildSuccessObservation({
    plan,
    queryKey: 'q1',
    sampleIndex,
    batchId: 'b1',
    observationId: obsId,
    evidenceId: eviId,
    observedAt: '2026-08-12T00:00:00.000Z',
    confidence: 0.9,
    citations: [],
    rawResponse: `raw answer ${sampleIndex}`,
  })
}

/** 每个 persistBatch 调用都要带 clientId + querySetId（WP03 每张表都有这两列）。 */
const ids = { clientId: 'c1', querySetId: 'qs1' } as const

describe('GeoFakeStore 原子不变式', () => {
  it('同一 batchId 落两次 → 拒（不可变），且不覆盖', async () => {
    const store = new GeoFakeStore()
    await store.persistBatch({ ...ids, batch: batch(), observations: [], evidence: [] })
    await expect(
      store.persistBatch({ ...ids, batch: batch(), observations: [], evidence: [] }),
    ).rejects.toBeInstanceOf(GeoFakeStoreError)
    expect(await store.listBatchIds('c1')).toHaveLength(1)
  })

  it('批内重复维度（同 queryKey/engine/model/locale/market/sampleIndex）→ 拒，一行不写', async () => {
    const store = new GeoFakeStore()
    const a = success(0, 'o1', 'e1')
    const b = success(0, 'o2', 'e2') // 同 sampleIndex 0 → dedupe key 相同
    await expect(
      store.persistBatch({
        ...ids,
        batch: batch(),
        observations: [a.observation, b.observation],
        evidence: [a.evidence, b.evidence],
      }),
    ).rejects.toThrow(/double_insert|duplicate/)
    expect(store.getBatch('b1')).toBeUndefined() // 什么都没写
  })

  it('成功观测缺证据 → 拒（success_without_evidence）', async () => {
    const store = new GeoFakeStore()
    const a = success(0, 'o1', 'e1')
    await expect(
      store.persistBatch({ ...ids, batch: batch(), observations: [a.observation], evidence: [] }),
    ).rejects.toMatchObject({ code: 'success_without_evidence' })
    expect(store.getBatch('b1')).toBeUndefined()
  })

  it('失败观测带证据 → 拒（failure_with_evidence）', async () => {
    const store = new GeoFakeStore()
    const failed = buildFailedObservation({
      plan,
      queryKey: 'q1',
      sampleIndex: 0,
      batchId: 'b1',
      observationId: 'o1',
      observedAt: '2026-08-12T00:00:00.000Z',
      errorCode: 'boom',
      errorMessage: 'x',
    })
    const evidence: GeoEvidenceRecord = {
      evidence: {
        evidenceId: 'e1',
        observationId: 'o1',
        rawResponseLocator: { known: false, reason: 'not_applicable' },
        citations: [],
      },
      rawResponse: { known: false, reason: 'not_applicable' },
    }
    await expect(
      store.persistBatch({ ...ids, batch: batch(), observations: [failed], evidence: [evidence] }),
    ).rejects.toMatchObject({ code: 'failure_with_evidence' })
    expect(store.getBatch('b1')).toBeUndefined()
  })

  it('缺 clientId → 拒', async () => {
    const store = new GeoFakeStore()
    await expect(
      store.persistBatch({ ...ids, clientId: '', batch: batch(), observations: [], evidence: [] }),
    ).rejects.toThrow(/client/)
  })

  it('缺 querySetId → 拒（WP03 geo_batches.query_set_id 是 NOT NULL）', async () => {
    const store = new GeoFakeStore()
    await expect(
      store.persistBatch({ ...ids, querySetId: '', batch: batch(), observations: [], evidence: [] }),
    ).rejects.toMatchObject({ code: 'missing_query_set_id' })
  })

  it('定位符声称有原文、实际没有 → 拒（locator 不许指向空气）', async () => {
    const store = new GeoFakeStore()
    const a = success(0, 'o1', 'e1')
    const noBackingData: GeoEvidenceRecord = {
      evidence: a.evidence.evidence, // 带 known locator
      rawResponse: { known: false, reason: 'not_recorded_by_source' }, // 却没有正文
    }
    await expect(
      store.persistBatch({
        ...ids,
        batch: batch({ actualCoverage: { ...emptyCoverage, attempted: 1, succeeded: 1 } }),
        observations: [a.observation],
        evidence: [noBackingData],
      }),
    ).rejects.toMatchObject({ code: 'evidence_locator_without_backing_data' })
    expect(store.getBatch('b1')).toBeUndefined()
  })

  it('实际覆盖三数对不上 → 拒（attempted != succeeded + failed）', async () => {
    const store = new GeoFakeStore()
    await expect(
      store.persistBatch({
        ...ids,
        batch: batch({ actualCoverage: { ...emptyCoverage, attempted: 5, succeeded: 1, failed: 1 } }),
        observations: [],
        evidence: [],
      }),
    ).rejects.toMatchObject({ code: 'actual_counts_do_not_add_up' })
  })

  it('批次成本是 NaN → 拒（geo_batches_cost_is_a_real_amount）', async () => {
    const store = new GeoFakeStore()
    await expect(
      store.persistBatch({
        ...ids,
        batch: batch({ costUsd: { known: true, value: Number.NaN } }),
        observations: [],
        evidence: [],
      }),
    ).rejects.toMatchObject({ code: 'batch_cost_not_a_real_amount' })
  })

  // 🔴 下面两条**直接打 store**，不经过 runtime。
  //    runtime 现在也在落库前跑 WP02 校验（那是 Codex 要求的、不许把契约闸门寄托在
  //    某个 store 实现上），于是 store 自己那道闸会被前一道挡住、永远测不到 ——
  //    除非像这样绕开 runtime 单独直测。两道闸各自成立才算数。
  it('store 自己也拦不合契约的观测（不依赖 runtime 先验过）', async () => {
    const store = new GeoFakeStore()
    const a = success(0, 'o1', 'e1')
    const broken = { ...a.observation, confidence: { known: true as const, value: 1.5 } } // 超出 [0,1]
    await expect(
      store.persistBatch({
        ...ids,
        batch: batch({ actualCoverage: { ...emptyCoverage, attempted: 1, succeeded: 1 } }),
        observations: [broken],
        evidence: [a.evidence],
      }),
    ).rejects.toMatchObject({ code: 'invalid_observation' })
    expect(store.getBatch('b1')).toBeUndefined()
  })

  it('store 自己也拦不合契约的证据（不依赖 runtime 先验过）', async () => {
    const store = new GeoFakeStore()
    const a = success(0, 'o1', 'e1')
    const brokenEvidence: GeoEvidenceRecord = {
      // citations 必须是数组；这里塞个非数组，WP02 校验器该当场拒
      evidence: { ...a.evidence.evidence, citations: 'not-an-array' as unknown as [] },
      rawResponse: a.evidence.rawResponse,
    }
    await expect(
      store.persistBatch({
        ...ids,
        batch: batch({ actualCoverage: { ...emptyCoverage, attempted: 1, succeeded: 1 } }),
        observations: [a.observation],
        evidence: [brokenEvidence],
      }),
    ).rejects.toMatchObject({ code: 'invalid_evidence' })
    expect(store.getBatch('b1')).toBeUndefined()
  })

  it('定位符与正文都在、但定位符不是库会生成的那个 → 拒', async () => {
    const store = new GeoFakeStore()
    const a = success(0, 'o1', 'e1')
    const wrongLocator: GeoEvidenceRecord = {
      evidence: { ...a.evidence.evidence, rawResponseLocator: { known: true, value: 'db://elsewhere/nope' } },
      rawResponse: a.evidence.rawResponse,
    }
    await expect(
      store.persistBatch({
        ...ids,
        batch: batch({ actualCoverage: { ...emptyCoverage, attempted: 1, succeeded: 1 } }),
        observations: [a.observation],
        evidence: [wrongLocator],
      }),
    ).rejects.toMatchObject({ code: 'evidence_locator_mismatch' })
  })

  it('落库后存的是 WP03 的行：双列 XOR、client_id / query_set_id 正确、原文逐字保留', async () => {
    const store = new GeoFakeStore()
    const a = success(0, 'o1', 'e1')
    await store.persistBatch({
      ...ids,
      batch: batch({ actualCoverage: { ...emptyCoverage, attempted: 1, succeeded: 1 } }),
      observations: [a.observation],
      evidence: [a.evidence],
    })
    const rows = store.getBatch('b1')!

    expect(rows.batch.client_id).toBe('c1')
    expect(rows.batch.query_set_id).toBe('qs1')
    // 已知值列有值、理由列为空；反之亦然（num_nonnulls = 1）
    expect(rows.batch.cost_usd).toBe(0)
    expect(rows.batch.cost_usd_unknown_reason).toBeNull()
    expect(rows.batch.triggered_by).toBeNull()
    expect(rows.batch.triggered_by_unknown_reason).toBe('not_applicable')

    const obs = rows.observations[0]
    expect(obs.query_key).toBe('q1')
    expect(obs.query_key_unknown_reason).toBeNull()
    expect(obs.sampling_parameters).toBeNull()
    expect(obs.sampling_parameters_unknown_reason).toBe('not_applicable')
    expect(obs.confidence).toBe(0.9)
    expect(obs.source_observation_id).toBeNull()

    const evi = rows.evidence[0]
    expect(evi.raw_response).toBe('raw answer 0') // 真实原文，不是空壳
    expect(evi.raw_response_locator).toBe('db://public.geo_evidence/e1/raw_response')
  })
})
