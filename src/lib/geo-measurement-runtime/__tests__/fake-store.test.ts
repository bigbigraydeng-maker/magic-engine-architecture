/**
 * 假 store 直接测：WP03 不变式的原子建模（Issue #874 / WP04）。
 * 任一不变式被违反 → 抛错且**一行都不写**。
 */

import { describe, it, expect } from 'vitest'
import { buildFailedObservation, buildSuccessObservation } from '../observation'
import { GeoFakeStore, GeoFakeStoreError } from '../fake-store'
import type { GeoBatch } from '@/lib/geo-measurement'
import type { GeoFrozenPlan } from '../types'

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

function batch(over: Partial<GeoBatch> = {}): GeoBatch {
  const cov = { engines: [], models: [], locales: [], markets: [], queryKeys: [], attempted: 0, succeeded: 0, failed: 0 }
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
  })
}

describe('GeoFakeStore 原子不变式', () => {
  it('同一 batchId 落两次 → 拒（不可变），且不覆盖', async () => {
    const store = new GeoFakeStore()
    await store.persistBatch({ clientId: 'c1', batch: batch(), observations: [], evidence: [] })
    await expect(
      store.persistBatch({ clientId: 'c1', batch: batch(), observations: [], evidence: [] }),
    ).rejects.toBeInstanceOf(GeoFakeStoreError)
    expect(await store.listBatchIds('c1')).toHaveLength(1)
  })

  it('批内重复维度（同 queryKey/engine/model/locale/market/sampleIndex）→ 拒，一行不写', async () => {
    const store = new GeoFakeStore()
    const a = success(0, 'o1', 'e1')
    const b = success(0, 'o2', 'e2') // 同 sampleIndex 0 → dedupe key 相同
    await expect(
      store.persistBatch({
        clientId: 'c1',
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
      store.persistBatch({ clientId: 'c1', batch: batch(), observations: [a.observation], evidence: [] }),
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
    const evidence = { evidenceId: 'e1', observationId: 'o1', rawResponseLocator: { known: false as const, reason: 'not_applicable' as const }, citations: [] }
    await expect(
      store.persistBatch({ clientId: 'c1', batch: batch(), observations: [failed], evidence: [evidence] }),
    ).rejects.toMatchObject({ code: 'failure_with_evidence' })
    expect(store.getBatch('b1')).toBeUndefined()
  })

  it('缺 clientId → 拒', async () => {
    const store = new GeoFakeStore()
    await expect(
      store.persistBatch({ clientId: '', batch: batch(), observations: [], evidence: [] }),
    ).rejects.toThrow(/client/)
  })
})
