/**
 * Magic Engine 2.0 · GEO Measurement Runtime —— 落库前完整性对账（Issue #874 / WP04）
 *
 * 🔴 授权第 5 条：WP04 必须**自己检测并拒绝**半成品成功态 —— 绝不能把「成功观测却缺证据」
 *    描述成完成。WP03 的 `UNIQUE(observation_id)` 只保证「最多一条证据」，保证不了
 *    「至少一条」；那是写入方的义务，就落在这里。
 *
 * 🔴 **纯函数。** 在把批次交给 store 之前跑一遍；任何违背都返回具体理由，让 runtime
 *    当场停下、不落一条半成品。
 */

import type { GeoEvidence, GeoObservation } from '@/lib/geo-measurement'

export type GeoIntegrityResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly reason: string }

const bad = (code: string, reason: string): GeoIntegrityResult => ({ ok: false, code, reason })

/**
 * 校验「观测 ↔ 证据」的一一对应：
 * · 每条 `ok:true` 观测必须恰好有一条 evidence，且 evidence.observationId 指回它；
 * · 每条 `ok:false` 观测**不得**有 evidence；
 * · 不存在孤儿 evidence（指向不存在或失败的观测）；
 * · evidence 之间 observationId 不重复。
 */
export function checkObservationEvidenceIntegrity(
  observations: readonly GeoObservation[],
  evidence: readonly GeoEvidence[],
): GeoIntegrityResult {
  const evidenceByObs = new Map<string, GeoEvidence>()
  for (const e of evidence) {
    if (evidenceByObs.has(e.observationId)) {
      return bad('duplicate_evidence', `two evidence rows point at observation ${e.observationId}`)
    }
    evidenceByObs.set(e.observationId, e)
  }

  const obsIds = new Set(observations.map((o) => o.observationId))
  for (const e of evidence) {
    if (!obsIds.has(e.observationId)) {
      return bad('orphan_evidence', `evidence ${e.evidenceId} points at unknown observation ${e.observationId}`)
    }
  }

  for (const o of observations) {
    const e = evidenceByObs.get(o.observationId)
    if (o.outcome.ok) {
      if (!e) return bad('success_without_evidence', `successful observation ${o.observationId} has no evidence`)
      if (o.outcome.evidenceId !== e.evidenceId) {
        return bad(
          'evidence_id_mismatch',
          `observation ${o.observationId} references evidence ${o.outcome.evidenceId} but stored evidence is ${e.evidenceId}`,
        )
      }
    } else if (e) {
      return bad('failure_with_evidence', `failed observation ${o.observationId} must not carry evidence`)
    }
  }

  return { ok: true }
}

/**
 * 崩溃窗口对账：批次声称的 actual.attempted 必须等于实际观测行数，
 * actual.succeeded 必须等于带证据的成功观测数。用于**读取 / 巡检**时发现
 * 「批次说跑了 N 条，库里只有 M 条」或「成功观测缺证据」的落库中断。
 */
export function checkCoverageMatchesRows(args: {
  claimedAttempted: number
  claimedSucceeded: number
  claimedFailed: number
  observations: readonly GeoObservation[]
  evidence: readonly GeoEvidence[]
}): GeoIntegrityResult {
  const succeeded = args.observations.filter((o) => o.outcome.ok).length
  const failed = args.observations.length - succeeded
  if (args.claimedAttempted !== args.observations.length) {
    return bad(
      'attempted_row_mismatch',
      `batch claims attempted=${args.claimedAttempted} but ${args.observations.length} observation rows exist`,
    )
  }
  if (args.claimedSucceeded !== succeeded) {
    return bad('succeeded_row_mismatch', `batch claims succeeded=${args.claimedSucceeded} but ${succeeded} ok rows exist`)
  }
  if (args.claimedFailed !== failed) {
    return bad('failed_row_mismatch', `batch claims failed=${args.claimedFailed} but ${failed} failed rows exist`)
  }
  if (args.evidence.length !== succeeded) {
    return bad('evidence_count_mismatch', `${succeeded} successful observations but ${args.evidence.length} evidence rows`)
  }
  return { ok: true }
}
