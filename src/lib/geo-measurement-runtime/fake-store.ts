/**
 * Magic Engine 2.0 · GEO Measurement Runtime —— in-memory 假 store（Issue #874 / WP04）
 *
 * 🔴 授权：v1 **先用假 / in-memory store**，绝不查、不写生产库。这个 store 把 WP03
 *    migration 里那几条**真正拦得住事故**的不变式在内存里建模，好让原子性 / 失败 / 重复
 *    运行这些性质能被测试证明：
 *    · 批次不可变          —— 同一 batchId 落两次 → 拒（对应 geo_immutable_row）
 *    · 批内不重复插入      —— (queryKey, engine, model, locale, market, sampleIndex) 唯一
 *                             （对应 idx_geo_observations_no_double_insert，NULLS NOT DISTINCT）
 *    · 证据一一对应        —— 每条成功观测一条证据，失败观测无证据
 *    · **原子性**          —— 任一不变式被违反，整批抛错、**一行都不写**
 *
 * 🔴 这个 store 复用了 legacy provider **client** 的精神（只调用、不落库），但**绝不**复用
 *    legacy orchestrator 的 upsert/覆盖语义 —— 重复运行创建**新批次**，从不覆盖旧批次。
 */

import { validateGeoEvidence, validateGeoObservation } from '@/lib/geo-measurement'
import type { GeoBatch, GeoEvidence, GeoObservation } from '@/lib/geo-measurement'
import { checkObservationEvidenceIntegrity } from './reconcile'
import type { GeoBatchPersistInput, GeoRuntimeStore } from './types'

export class GeoFakeStoreError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'GeoFakeStoreError'
    this.code = code
  }
}

interface StoredBatch {
  readonly clientId: string
  readonly batch: GeoBatch
  readonly observations: readonly GeoObservation[]
  readonly evidence: readonly GeoEvidence[]
}

function dedupeKey(o: GeoObservation): string {
  const a = o.acquisition
  const part = (v: { known: boolean; value?: unknown }): string => (v.known ? `k:${String(v.value)}` : 'unknown')
  // NULLS NOT DISTINCT 的语义：两条各维度都相同、且都「未知」的观测视为重复。
  return [
    part(a.queryKey),
    part(a.engineFamily),
    part(a.modelVersion),
    part(a.locale),
    part(a.market),
    part(a.sample.sampleIndex),
  ].join('|')
}

/**
 * in-memory store。`persistBatch` 是**全有或全无**：先在暂存副本上把所有不变式验一遍，
 * 全过了才一次性提交到 `#batches`；任何一条不过就抛 {@link GeoFakeStoreError}，
 * `#batches` 一个字节都不变。
 */
export class GeoFakeStore implements GeoRuntimeStore {
  private readonly batches = new Map<string, StoredBatch>()

  async persistBatch(input: GeoBatchPersistInput): Promise<void> {
    this.assertAtomicallyValid(input)
    this.batches.set(input.batch.batchId, {
      clientId: input.clientId,
      batch: input.batch,
      observations: [...input.observations],
      evidence: [...input.evidence],
    })
  }

  async listBatchIds(clientId: string): Promise<readonly string[]> {
    const ids: string[] = []
    for (const stored of Array.from(this.batches.values())) {
      if (stored.clientId === clientId) ids.push(stored.batch.batchId)
    }
    return ids
  }

  /** 只读，供测试断言落库内容。 */
  getBatch(batchId: string): StoredBatch | undefined {
    return this.batches.get(batchId)
  }

  private assertAtomicallyValid(input: GeoBatchPersistInput): void {
    if (typeof input.clientId !== 'string' || input.clientId.trim().length === 0) {
      throw new GeoFakeStoreError('missing_client_id', 'persist input requires a non-empty clientId')
    }
    // 1. 批次不可变：同一 batchId 不得落两次。
    if (this.batches.has(input.batch.batchId)) {
      throw new GeoFakeStoreError('batch_immutable', `batch ${input.batch.batchId} already persisted; batches are immutable`)
    }

    // 2. 每条观测 / 证据必须过 WP02 校验器（落库前的形状闸）。
    for (const o of input.observations) {
      const r = validateGeoObservation(o)
      if (!r.ok) throw new GeoFakeStoreError('invalid_observation', r.reason)
      if (o.batchId !== input.batch.batchId) {
        throw new GeoFakeStoreError('observation_wrong_batch', `observation ${o.observationId} batchId != batch`)
      }
    }
    for (const e of input.evidence) {
      const r = validateGeoEvidence(e)
      if (!r.ok) throw new GeoFakeStoreError('invalid_evidence', r.reason)
    }

    // 3. 批内不重复插入（NULLS NOT DISTINCT）。
    const seen = new Set<string>()
    for (const o of input.observations) {
      const k = dedupeKey(o)
      if (seen.has(k)) {
        throw new GeoFakeStoreError('double_insert', `duplicate observation dimensions within batch: ${k}`)
      }
      seen.add(k)
    }

    // 4. 观测 ↔ 证据一一对应（成功必带、失败必无）。
    const integrity = checkObservationEvidenceIntegrity(input.observations, input.evidence)
    if (!integrity.ok) throw new GeoFakeStoreError(integrity.code, integrity.reason)
  }
}
