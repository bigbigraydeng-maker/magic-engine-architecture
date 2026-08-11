/**
 * 完整性对账 —— 检测「成功却缺证据」「批次账与行数不符」等落库中断（Issue #874 / WP04）。
 */

import { describe, it, expect } from 'vitest'
import { buildFailedObservation, buildSuccessObservation } from '../observation'
import { checkCoverageMatchesRows, checkObservationEvidenceIntegrity } from '../reconcile'
import type { GeoEvidence } from '@/lib/geo-measurement'
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

const ok = (i: number) =>
  buildSuccessObservation({
    plan,
    queryKey: 'q1',
    sampleIndex: i,
    batchId: 'b1',
    observationId: `o${i}`,
    evidenceId: `e${i}`,
    observedAt: '2026-08-12T00:00:00.000Z',
    confidence: 0.9,
    citations: [],
  })

const fail = (i: number) =>
  buildFailedObservation({
    plan,
    queryKey: 'q1',
    sampleIndex: i,
    batchId: 'b1',
    observationId: `o${i}`,
    observedAt: '2026-08-12T00:00:00.000Z',
    errorCode: 'boom',
    errorMessage: 'x',
  })

describe('checkObservationEvidenceIntegrity', () => {
  it('成功配证据 + 失败无证据 → ok', () => {
    const a = ok(0)
    const r = checkObservationEvidenceIntegrity([a.observation, fail(1)], [a.evidence])
    expect(r.ok).toBe(true)
  })

  it('成功却缺证据 → success_without_evidence', () => {
    const a = ok(0)
    const r = checkObservationEvidenceIntegrity([a.observation], [])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('success_without_evidence')
  })

  it('失败却带证据 → failure_with_evidence', () => {
    const evidence: GeoEvidence = {
      evidenceId: 'e1',
      observationId: 'o1',
      rawResponseLocator: { known: false, reason: 'not_applicable' },
      citations: [],
    }
    const r = checkObservationEvidenceIntegrity([fail(1)], [evidence])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('failure_with_evidence')
  })

  it('孤儿证据（指向不存在的观测）→ orphan_evidence', () => {
    const evidence: GeoEvidence = {
      evidenceId: 'e9',
      observationId: 'nope',
      rawResponseLocator: { known: false, reason: 'not_applicable' },
      citations: [],
    }
    const r = checkObservationEvidenceIntegrity([], [evidence])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('orphan_evidence')
  })

  it('两条证据指向同一观测 → duplicate_evidence', () => {
    const a = ok(0)
    const dup: GeoEvidence = { ...a.evidence, evidenceId: 'e-dup' }
    const r = checkObservationEvidenceIntegrity([a.observation], [a.evidence, dup])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('duplicate_evidence')
  })

  it('观测引用的 evidenceId 与实际证据不符 → evidence_id_mismatch', () => {
    const a = ok(0)
    const mismatched: GeoEvidence = { ...a.evidence, evidenceId: 'different' }
    const r = checkObservationEvidenceIntegrity([a.observation], [mismatched])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('evidence_id_mismatch')
  })
})

describe('checkCoverageMatchesRows', () => {
  const a = ok(0)
  const base = { observations: [a.observation, fail(1)], evidence: [a.evidence] }

  it('账与行数吻合 → ok', () => {
    const r = checkCoverageMatchesRows({ claimedAttempted: 2, claimedSucceeded: 1, claimedFailed: 1, ...base })
    expect(r.ok).toBe(true)
  })

  it('声称 attempted 与观测行数不符 → attempted_row_mismatch', () => {
    const r = checkCoverageMatchesRows({ claimedAttempted: 5, claimedSucceeded: 1, claimedFailed: 1, ...base })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('attempted_row_mismatch')
  })

  it('声称 succeeded 与成功行数不符 → succeeded_row_mismatch', () => {
    const r = checkCoverageMatchesRows({ claimedAttempted: 2, claimedSucceeded: 2, claimedFailed: 0, ...base })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('succeeded_row_mismatch')
  })

  it('成功数与证据行数不符 → evidence_count_mismatch', () => {
    const r = checkCoverageMatchesRows({
      claimedAttempted: 2,
      claimedSucceeded: 1,
      claimedFailed: 1,
      observations: [a.observation, fail(1)],
      evidence: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('evidence_count_mismatch')
  })
})
