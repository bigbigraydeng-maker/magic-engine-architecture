/**
 * Magic Engine 2.0 · GEO Measurement Runtime —— in-memory 假 store（Issue #874 / WP04）
 *
 * 🔴 授权：v1 **先用假 / in-memory store**，绝不查、不写生产库。
 *
 * 🔴 **存的是 WP03 的行**（`GeoBatchRow` / `GeoObservationRow` / `GeoEvidenceRow`），
 *    不是 domain 对象的副本。理由是这个假件唯一的价值就是「提前撞出真实写入会撞的问题」：
 *    存 domain 对象的话，双列（`<field>` / `<field>_unknown_reason`）、`client_id` /
 *    `query_set_id` 的落点、`raw_response` 逐字保留、`source_observation_id` 恒 null
 *    这些**真实写入必然要面对**的事，一件都不会在测试里出现。
 *
 * 建模的 WP03 不变式：
 *    · 批次不可变          —— 同一 batchId 落两次 → 拒（对应 geo_immutable_row）
 *    · 批内不重复插入      —— (query_key, engine_family, model_version, locale, market,
 *                             sample_index) 唯一（对应 idx_geo_observations_no_double_insert）
 *    · 双列 XOR            —— 每对 `<field>` / `<field>_unknown_reason` 恰好一个非空
 *    · 成败与错误列一致    —— 失败必有 error_code、成功不许有（geo_obs_error_code_matches_outcome）
 *    · 实际覆盖三数对得上  —— attempted = succeeded + failed（geo_batches_actual_counts_add_up）
 *    · 花费是真实金额      —— 非 NaN / 非 Infinity / 非负（geo_batches_cost_is_a_real_amount）
 *    · 证据一一对应        —— 每条成功观测一条证据，失败观测无证据
 *    · 定位符有兜底        —— raw_response_locator 非空 ⇔ raw_response 非空
 *    · **原子性**          —— 任一不变式被违反，整批抛错、**一行都不写**
 *
 * 🔴 绝不复用 legacy orchestrator 的 upsert/覆盖语义 —— 重复运行创建**新批次**。
 */

import { validateGeoEvidence, validateGeoObservation } from '@/lib/geo-measurement'
import type { GeoBatchRow, GeoEvidenceRow, GeoObservationRow } from '@/lib/geo-measurement-store/types'
import { checkObservationEvidenceIntegrity } from './reconcile'
import { deriveRawResponseLocator, toGeoBatchRow, toGeoEvidenceRow, toGeoObservationRow } from './row-mapper'
import type { GeoBatchPersistInput, GeoRuntimeStore } from './types'

export class GeoFakeStoreError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'GeoFakeStoreError'
    this.code = code
  }
}

/** 一个批次落库后的行集合 —— 与真实库里那三张表的内容同形。 */
export interface StoredBatchRows {
  readonly batch: GeoBatchRow
  readonly observations: readonly GeoObservationRow[]
  readonly evidence: readonly GeoEvidenceRow[]
}

/** idx_geo_observations_no_double_insert 的 NULLS NOT DISTINCT 语义。 */
function dedupeKey(row: GeoObservationRow): string {
  const part = (v: string | number | null): string => (v === null ? 'NULL' : `v:${String(v)}`)
  return [
    part(row.query_key),
    part(row.engine_family),
    part(row.model_version),
    part(row.locale),
    part(row.market),
    part(row.sample_index),
  ].join('|')
}

/** `num_nonnulls(a, b) = 1` —— 双列恰好一个非空。 */
function xorOk(value: unknown, reason: unknown): boolean {
  return (value === null) !== (reason === null)
}

/**
 * in-memory store。`persistBatch` 是**全有或全无**：先把 domain 映射成行、把所有不变式
 * 验一遍，全过了才一次性提交；任何一条不过就抛 {@link GeoFakeStoreError}，已存的行一个
 * 字节都不变。
 */
export class GeoFakeStore implements GeoRuntimeStore {
  private readonly batches = new Map<string, { clientId: string; rows: StoredBatchRows }>()

  async persistBatch(input: GeoBatchPersistInput): Promise<void> {
    const rows = this.buildAndValidateRows(input)
    this.batches.set(input.batch.batchId, { clientId: input.clientId, rows })
  }

  async listBatchIds(clientId: string): Promise<readonly string[]> {
    const ids: string[] = []
    for (const entry of Array.from(this.batches.values())) {
      if (entry.clientId === clientId) ids.push(entry.rows.batch.id)
    }
    return ids
  }

  /** 只读，供测试断言真正落进去的**行**。 */
  getBatch(batchId: string): StoredBatchRows | undefined {
    return this.batches.get(batchId)?.rows
  }

  /**
   * 映射 + 全量校验。**不改动 `this.batches`** —— 抛错即等于什么都没发生，
   * 原子性靠「先全验完再一次性 set」实现，不靠回滚。
   */
  private buildAndValidateRows(input: GeoBatchPersistInput): StoredBatchRows {
    if (typeof input.clientId !== 'string' || input.clientId.trim().length === 0) {
      throw new GeoFakeStoreError('missing_client_id', 'persist input requires a non-empty clientId')
    }
    if (typeof input.querySetId !== 'string' || input.querySetId.trim().length === 0) {
      throw new GeoFakeStoreError('missing_query_set_id', 'persist input requires a non-empty querySetId')
    }
    if (this.batches.has(input.batch.batchId)) {
      throw new GeoFakeStoreError('batch_immutable', `batch ${input.batch.batchId} already persisted; batches are immutable`)
    }

    // WP02 形状闸（runtime 已经在调用前验过一遍；这里是纵深防御，不是唯一防线）。
    for (const o of input.observations) {
      const r = validateGeoObservation(o)
      if (!r.ok) throw new GeoFakeStoreError('invalid_observation', r.reason)
      if (o.batchId !== input.batch.batchId) {
        throw new GeoFakeStoreError('observation_wrong_batch', `observation ${o.observationId} batchId != batch`)
      }
    }
    for (const rec of input.evidence) {
      const r = validateGeoEvidence(rec.evidence)
      if (!r.ok) throw new GeoFakeStoreError('invalid_evidence', r.reason)

      // 🔴 定位符必须有真实正文兜底，且必须就是库里 GENERATED 列会算出来的那一个。
      //    判据比的是**契约对象声称的定位符**与**随行正文** —— 不是比映射出来的行的两个
      //    字段（那两个都由 mapper 从同一个正文推导，永远自洽，那种断言一辈子不会响）。
      const claimed = rec.evidence.rawResponseLocator
      const derived = deriveRawResponseLocator(rec.evidence.evidenceId, rec.rawResponse.known ? rec.rawResponse.value : null)
      if (claimed.known !== rec.rawResponse.known) {
        throw new GeoFakeStoreError(
          'evidence_locator_without_backing_data',
          `evidence ${rec.evidence.evidenceId}: locator ${claimed.known ? 'claimed' : 'absent'} but raw response ${rec.rawResponse.known ? 'present' : 'absent'}`,
        )
      }
      if (claimed.known && claimed.value !== derived) {
        throw new GeoFakeStoreError(
          'evidence_locator_mismatch',
          `evidence ${rec.evidence.evidenceId}: locator "${claimed.value}" != generated "${String(derived)}"`,
        )
      }
    }

    // 观测 ↔ 证据一一对应（成功必带、失败必无）。
    const integrity = checkObservationEvidenceIntegrity(
      input.observations,
      input.evidence.map((r) => r.evidence),
    )
    if (!integrity.ok) throw new GeoFakeStoreError(integrity.code, integrity.reason)

    const createdAt = input.batch.startedAt
    const batchRow = toGeoBatchRow({
      batch: input.batch,
      clientId: input.clientId,
      querySetId: input.querySetId,
      createdAt,
    })
    const observationRows = input.observations.map((o) =>
      toGeoObservationRow({ observation: o, clientId: input.clientId, createdAt }),
    )
    const evidenceRows = input.evidence.map((rec) =>
      toGeoEvidenceRow({
        evidence: rec.evidence,
        rawResponse: rec.rawResponse,
        clientId: input.clientId,
        createdAt,
      }),
    )

    this.assertBatchRow(batchRow)
    this.assertObservationRows(batchRow, observationRows)
    this.assertEvidenceRows(batchRow, observationRows, evidenceRows)

    return { batch: batchRow, observations: observationRows, evidence: evidenceRows }
  }

  private assertBatchRow(row: GeoBatchRow): void {
    if (!xorOk(row.completed_at, row.completed_at_unknown_reason)) {
      throw new GeoFakeStoreError('batch_completed_at_xor', 'completed_at / completed_at_unknown_reason must be exactly one')
    }
    if (!xorOk(row.cost_usd, row.cost_usd_unknown_reason)) {
      throw new GeoFakeStoreError('batch_cost_xor', 'cost_usd / cost_usd_unknown_reason must be exactly one')
    }
    if (!xorOk(row.triggered_by, row.triggered_by_unknown_reason)) {
      throw new GeoFakeStoreError('batch_triggered_by_xor', 'triggered_by / triggered_by_unknown_reason must be exactly one')
    }
    // geo_batches_cost_is_a_real_amount：NaN 能绕过 `>= 0`，必须单独拦。
    if (row.cost_usd !== null && (!Number.isFinite(row.cost_usd) || row.cost_usd < 0)) {
      throw new GeoFakeStoreError('batch_cost_not_a_real_amount', `cost_usd ${row.cost_usd} is not a real amount`)
    }
    for (const [label, cov] of [
      ['planned_coverage', row.planned_coverage],
      ['actual_coverage', row.actual_coverage],
    ] as const) {
      for (const key of ['engines', 'models', 'locales', 'markets', 'queryKeys'] as const) {
        if (!Array.isArray(cov[key])) throw new GeoFakeStoreError('coverage_shape', `${label}.${key} must be an array`)
      }
      for (const key of ['attempted', 'succeeded', 'failed'] as const) {
        const n = cov[key]
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
          throw new GeoFakeStoreError('coverage_counts', `${label}.${key} must be a non-negative integer`)
        }
      }
    }
    // geo_batches_actual_counts_add_up（只管 actual，planned 下单时 succeeded/failed 本就是 0）。
    const a = row.actual_coverage as { attempted: number; succeeded: number; failed: number }
    if (a.attempted !== a.succeeded + a.failed) {
      throw new GeoFakeStoreError('actual_counts_do_not_add_up', `attempted ${a.attempted} != ${a.succeeded} + ${a.failed}`)
    }
  }

  private assertObservationRows(batch: GeoBatchRow, rows: readonly GeoObservationRow[]): void {
    const seen = new Set<string>()
    for (const row of rows) {
      if (row.client_id !== batch.client_id) {
        throw new GeoFakeStoreError('observation_wrong_client', `observation ${row.id} client_id != batch client_id`)
      }
      if (row.batch_id !== batch.id) {
        throw new GeoFakeStoreError('observation_wrong_batch', `observation ${row.id} batch_id != batch id`)
      }
      const pairs: readonly (readonly [string, unknown, unknown])[] = [
        ['query_set_version', row.query_set_version, row.query_set_version_unknown_reason],
        ['query_key', row.query_key, row.query_key_unknown_reason],
        ['engine_family', row.engine_family, row.engine_family_unknown_reason],
        ['model_version', row.model_version, row.model_version_unknown_reason],
        ['locale', row.locale, row.locale_unknown_reason],
        ['market', row.market, row.market_unknown_reason],
        ['sample_planned_count', row.sample_planned_count, row.sample_planned_count_unknown_reason],
        ['sample_index', row.sample_index, row.sample_index_unknown_reason],
        ['sampling_parameters', row.sampling_parameters, row.sampling_parameters_unknown_reason],
        ['parser_version', row.parser_version, row.parser_version_unknown_reason],
        ['metric_rules_version', row.metric_rules_version, row.metric_rules_version_unknown_reason],
        ['confidence', row.confidence, row.confidence_unknown_reason],
      ]
      for (const [name, value, reason] of pairs) {
        if (!xorOk(value, reason)) {
          throw new GeoFakeStoreError('observation_column_xor', `${name} / ${name}_unknown_reason must be exactly one`)
        }
      }
      // geo_obs_confidence_is_a_ratio
      if (row.confidence !== null && (!Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1)) {
        throw new GeoFakeStoreError('observation_confidence_not_a_ratio', `confidence ${row.confidence} is not in [0,1]`)
      }
      // geo_obs_error_code_matches_outcome：失败必有码，成功不许有。
      if (row.outcome_ok === (row.error_code !== null)) {
        throw new GeoFakeStoreError('observation_error_code_mismatch', `outcome_ok=${row.outcome_ok} conflicts with error_code`)
      }
      // geo_obs_error_message_absent_on_success
      if (row.outcome_ok && (row.error_message !== null || row.error_message_unknown_reason !== null)) {
        throw new GeoFakeStoreError('observation_error_message_on_success', 'successful observation must not carry an error message')
      }
      // geo_obs_error_message_present_on_failure
      if (!row.outcome_ok && !xorOk(row.error_message, row.error_message_unknown_reason)) {
        throw new GeoFakeStoreError('observation_error_message_xor', 'failed observation needs exactly one of message / unknown reason')
      }
      // geo_obs_source_is_not_self（正常采集恒为 null）
      if (row.source_observation_id !== null && row.source_observation_id === row.id) {
        throw new GeoFakeStoreError('observation_source_is_self', 'an observation cannot be its own reparse source')
      }
      const key = dedupeKey(row)
      if (seen.has(key)) {
        throw new GeoFakeStoreError('double_insert', `duplicate observation dimensions within batch: ${key}`)
      }
      seen.add(key)
    }
  }

  private assertEvidenceRows(
    batch: GeoBatchRow,
    observations: readonly GeoObservationRow[],
    rows: readonly GeoEvidenceRow[],
  ): void {
    const byId = new Map(observations.map((o) => [o.id, o]))
    for (const row of rows) {
      if (row.client_id !== batch.client_id) {
        throw new GeoFakeStoreError('evidence_wrong_client', `evidence ${row.id} client_id != batch client_id`)
      }
      const parent = byId.get(row.observation_id)
      if (!parent) {
        throw new GeoFakeStoreError('orphan_evidence', `evidence ${row.id} points at unknown observation ${row.observation_id}`)
      }
      if (!xorOk(row.raw_response, row.raw_response_unknown_reason)) {
        throw new GeoFakeStoreError('evidence_raw_response_xor', 'raw_response / raw_response_unknown_reason must be exactly one')
      }
      if (!Array.isArray(row.citations)) {
        throw new GeoFakeStoreError('evidence_citations_not_array', `evidence ${row.id} citations must be an array`)
      }
    }
  }
}
