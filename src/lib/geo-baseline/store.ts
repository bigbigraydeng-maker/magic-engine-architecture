/**
 * Magic Engine 2.0 · GEO Baseline —— 真实 WP03 store（Issue #883 / #917 · WP04A）
 *
 * 实现 WP04 的 `GeoRuntimeStore`（`src/lib/geo-measurement-runtime/types.ts:163-168`）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 原子性：靠一个数据库事务，不靠事后对账
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WP04 的 store 契约要求「要么整批写入、要么一行都不写」。走 PostgREST 逐表 INSERT
 * 做不到 —— 三张表就是三个事务，WP03 的 migration 自己写死了这件事
 * （`20260811000001_...sql:529-534`、`:897-898`）。
 *
 * 曾经的做法是「三条定序 INSERT + 事后对账 + 不一致就大声失败」。**那个做法是错的**：
 * 对账只能**发现**污染，不能**阻止**污染。而这三张表的 UPDATE / DELETE 被
 * `geo_immutable_row`（`:789-819`）全禁 —— 半截数据一旦写出去就**既补不上也删不掉**。
 * 「已声明的取舍」不能让契约违反变成不违反，何况代价不可逆。
 *
 * 现在：**唯一的写入路径是 `geo_persist_batch_v1` 这一个 RPC**
 * （`supabase/migrations/20260812000001_me2_geo_persist_batch_atomic_v1.sql`）。
 * 一个 plpgsql 函数体跑在单个事务里，任何一步抛错整批回滚，一行不留。
 *
 * 落库后的只读对账**保留**，但它的角色变了：不再是原子性的替代品，而是
 * 纵深验证（确认库里读回来的行真的与声称的覆盖账一致）。
 * 它失败不代表有孤儿 —— RPC 成功即意味着三张表都已提交。
 *
 * ⚠️ 那个 migration **尚未 apply**。apply 是单独授权的运维动作（A5）。
 *
 * 🔴 **不 import `@/lib/supabase`。** 客户端注入（照 `src/lib/kernel/store.ts:1-18`）。
 * 🔴 **查询失败一律抛错，绝不 `return []`。**「查不到」和「查炸了」返回同一个值，
 *    是这个仓库反复踩的那个坑。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  checkObservationEvidenceIntegrity,
  toGeoBatchRow,
  toGeoEvidenceRow,
  toGeoObservationRow,
} from '@/lib/geo-measurement-runtime'
import type { GeoBatchPersistInput, GeoRuntimeStore } from '@/lib/geo-measurement-runtime'
import type { GeoEvidenceRow, GeoObservationRow } from '@/lib/geo-measurement-store/types'

export const TABLE_BATCHES = 'geo_batches'
export const TABLE_OBSERVATIONS = 'geo_observations'
export const TABLE_EVIDENCE = 'geo_evidence'
export const TABLE_QUERY_SETS = 'geo_query_sets'
export const TABLE_QUERIES = 'geo_queries'

/** 唯一的写入路径。见 `supabase/migrations/20260812000001_me2_geo_persist_batch_atomic_v1.sql`。 */
export const RPC_PERSIST_BATCH = 'geo_persist_batch_v1'

/** 对账读证据时每批塞进 `.in()` 的 id 数上限（uuid × 50 ≈ 1.9 KB，离网关 header 上限很远）。 */
export const EVIDENCE_READBACK_CHUNK = 50

/**
 * 写进 `geo_observations.error_message` 的文本上限。
 *
 * 🔴 那一列是 `text`（无长度上限）且**落库即不可变**。provider 的错误原文会被原样带进去，
 *    一条超长的上游报错（含完整请求回显）会永久占着一行不可删的证据。截断留痕，别留全文。
 */
export const MAX_ERROR_MESSAGE_CHARS = 2000

/**
 * 落库过程中出的事。
 *
 * `committed` 为真 = RPC 已经原子提交成功、库里有完整的一批；此时重跑会产生重复批次。
 * `committed` 为假 = 整批回滚，一行不留，可以安全重跑。
 */
export class GeoStoreError extends Error {
  readonly code: string
  readonly committed: boolean
  constructor(code: string, message: string, committed = false) {
    super(message)
    this.name = 'GeoStoreError'
    this.code = code
    this.committed = committed
  }
}

/**
 * @param committed 这次失败发生时，RPC **是否已经提交成功**（即库里确实有这一批行）。
 *   🔴 对账阶段的读失败一律 `true`：那时 RPC 已经返回成功，三张表都已提交。
 *      不标出来的话，调用方只会印一句「跑挂了」，操作者按提示重跑，
 *      同一个查询集版本下就多出一批重复观测，覆盖率与失败率从此双倍。
 *      注意：这不是「孤儿」——批次是完整的，只是对账没读回来。
 */
function fail(op: string, error: { message?: string } | null, committed = false): never {
  throw new GeoStoreError(
    'query_failed',
    `[geo-baseline/store] ${op} 失败：${error?.message ?? '未知错误'}` +
      (committed ? '\n⚠️ 此时批次已经原子提交成功，库里有完整的一批 —— 不要重跑，先人工核对。' : ''),
    committed,
  )
}

/**
 * `raw_response_locator` 是库里的 `GENERATED ALWAYS AS ... STORED` 列
 * （migration `:508-512`）。**写入方给它赋值 Postgres 会直接拒。**
 * `row-mapper.toGeoEvidenceRow` 会把它推导出来（那是给假 store 验「定位符必须有正文兜底」用的），
 * 真实 INSERT 必须把它摘掉。
 */
export function stripGeneratedColumns(row: GeoEvidenceRow): Omit<GeoEvidenceRow, 'raw_response_locator'> {
  const { raw_response_locator: _generated, ...insertable } = row
  return insertable
}

/**
 * 把 `error_message` 截到 {@link MAX_ERROR_MESSAGE_CHARS}，并在截断处留痕。
 *
 * 🔴 截断要留痕，不能悄悄砍 —— 否则读的人分不清「上游就报了这么多」和「我们截过」。
 */
export function clampErrorMessage(row: GeoObservationRow): GeoObservationRow {
  const msg = row.error_message
  if (typeof msg !== 'string' || msg.length <= MAX_ERROR_MESSAGE_CHARS) return row
  const suffix = `…[truncated ${msg.length - MAX_ERROR_MESSAGE_CHARS} chars by geo-baseline store]`
  return { ...row, error_message: msg.slice(0, MAX_ERROR_MESSAGE_CHARS) + suffix }
}

export interface GeoSupabaseStoreOptions {
  readonly client: SupabaseClient
  /** 注入以便测试确定性。 */
  readonly now: () => string
}

export class GeoSupabaseStore implements GeoRuntimeStore {
  private readonly sb: SupabaseClient
  private readonly now: () => string

  constructor(options: GeoSupabaseStoreOptions) {
    this.sb = options.client
    this.now = options.now
  }

  async persistBatch(input: GeoBatchPersistInput): Promise<void> {
    const createdAt = this.now()
    const batchRow = toGeoBatchRow({
      batch: input.batch,
      clientId: input.clientId,
      querySetId: input.querySetId,
      createdAt,
    })
    const observationRows = input.observations.map((observation) =>
      clampErrorMessage(toGeoObservationRow({ observation, clientId: input.clientId, createdAt })),
    )
    const evidenceRows = input.evidence.map((record) =>
      toGeoEvidenceRow({
        evidence: record.evidence,
        rawResponse: record.rawResponse,
        clientId: input.clientId,
        createdAt,
      }),
    )

    // 落库**之前**再验一次一一对应。WP04 的 runtime 已经验过一遍，这里是纵深防御：
    // 一旦有半截数据进去就再也清不掉，这道闸比重复一次的代价贵得多。
    const integrity = checkObservationEvidenceIntegrity(
      input.observations,
      input.evidence.map((r) => r.evidence),
    )
    if (!integrity.ok) {
      throw new GeoStoreError(integrity.code, `落库前自检未过：${integrity.reason}`)
    }

    await this.persistAtomically(batchRow, observationRows, evidenceRows, input.clientId)
    // 纵深验证，**不是**原子性的实现手段 —— 原子性已经由上一行的事务保证。
    await this.reconcileAfterWrite(input, batchRow.id)
  }

  async listBatchIds(clientId: string): Promise<readonly string[]> {
    const { data, error } = await this.sb
      .from(TABLE_BATCHES)
      .select('id')
      .eq('client_id', clientId)
      .order('started_at', { ascending: true })
    if (error) fail(`listBatchIds(${clientId})`, error)
    if (data === null) {
      // 🔴 没有 error 又没有 data = 客户端行为不符合预期。不许当成「这个客户没有批次」。
      throw new GeoStoreError('null_result', `listBatchIds(${clientId}) 返回了 null data 且无 error`)
    }
    return data.map((row) => String((row as { id: unknown }).id))
  }

  /**
   * 唯一的写入路径：一个 RPC，一个事务。
   *
   * 🔴 **不做三条独立 INSERT。** 那样是三个事务，中途失败会留下不可删除的半截证据
   *    （WP03 的表禁 UPDATE/DELETE）。函数内任一步抛错 ⇒ 整批回滚，一行不留 ⇒
   *    调用方可以安全重跑。
   * 🔴 证据行的 `raw_response_locator` 是 GENERATED 列，这里在**送出之前**就摘掉；
   *    RPC 内部的 INSERT 列清单也不含它（两道都在，任一处漏了 Postgres 都会直接拒）。
   */
  private async persistAtomically(
    batchRow: ReturnType<typeof toGeoBatchRow>,
    observationRows: readonly GeoObservationRow[],
    evidenceRows: readonly GeoEvidenceRow[],
    clientId: string,
  ): Promise<void> {
    const { error } = await this.sb.rpc(RPC_PERSIST_BATCH, {
      p_client_id: clientId,
      p_batch: batchRow,
      p_observations: observationRows,
      p_evidence: evidenceRows.map(stripGeneratedColumns),
    })
    if (error) {
      // 整批回滚，一行不留 —— 可以安全重跑（用新批次 id）。
      throw new GeoStoreError(
        'atomic_persist_failed',
        `${RPC_PERSIST_BATCH} 失败，整批已回滚（库里一行都没留）：${error.message}`,
        false,
      )
    }
  }

  /**
   * 落库后对账 —— 选路线 ③ 的全部代价都押在这一步上。
   *
   * 🔴 **不是「再验一遍我刚写的对象」**（那恒为真、一辈子不会响），
   *    而是**把行从库里读回来**，拿真实行数与批次自己声称的覆盖账对。
   */
  private async reconcileAfterWrite(input: GeoBatchPersistInput, batchId: string): Promise<void> {
    const readBack = await this.readBackRows(input.clientId, batchId)
    const actual = input.batch.actualCoverage

    // 🔴 三条判据全部拿**从库里读回来的行**去比，不拿内存里的 input 自己跟自己比。
    //    此前最后一条是把 `input.*` 喂给 `checkCoverageMatchesRows`，而 WP04 的
    //    `runtime.ts` 在调用本方法之前刚用逐字相同的参数跑过同一个纯函数 ——
    //    那条断言恒为真，一辈子不会响，是一段假装成闸门的死代码。
    if (readBack.batchRowCount !== 1) {
      throw new GeoStoreError(
        'batch_row_missing',
        `🔴 批次 ${batchId} 原子提交成功后按 id 读回来得到 ${readBack.batchRowCount} 行（应为 1）。` +
          `RPC 说成功、库里却读不到 —— 这是一个需要人工核对的异常，不要直接重跑。`,
        true,
      )
    }
    if (readBack.observationIds.length !== actual.attempted) {
      throw new GeoStoreError(
        'coverage_row_count_mismatch',
        `🔴 批次 ${batchId} 声称尝试了 ${actual.attempted} 条观测，库里实际有 ${readBack.observationIds.length} 条。` +
          `这些行不可删除，必须人工登记。`,
        true,
      )
    }
    if (readBack.successIds.length !== actual.succeeded) {
      throw new GeoStoreError(
        'coverage_success_count_mismatch',
        `🔴 批次 ${batchId} 声称成功 ${actual.succeeded} 条，库里 outcome_ok=true 的有 ${readBack.successIds.length} 条。`,
        true,
      )
    }
    const failedInDb = readBack.observationIds.length - readBack.successIds.length
    if (failedInDb !== actual.failed) {
      throw new GeoStoreError(
        'coverage_failed_count_mismatch',
        `🔴 批次 ${batchId} 声称失败 ${actual.failed} 条，库里 outcome_ok=false 的有 ${failedInDb} 条。`,
        true,
      )
    }
    const missing = readBack.successIds.filter((id) => !readBack.evidenceObservationIds.has(id))
    if (missing.length > 0) {
      throw new GeoStoreError(
        'success_observation_without_evidence',
        `🔴 批次 ${batchId} 有 ${missing.length} 条成功观测在库里没有证据行：${missing.join(', ')}。` +
          `这正是 migration :529-534 说库层拦不住的那种行；它们不可删除，必须人工登记。`,
        true,
      )
    }
  }

  /**
   * 把这一批真正落进库里的行读回来。
   *
   * 🔴 证据按 `successIds` 分批查：`.in()` 会把 uuid 全部拼进 query string，
   *    200 条约 7.4 KB，已经贴着常见网关 8 KB header 上限。撞上去会在**所有行都已落库之后**
   *    抛一个读失败 —— 那是最坏的时机。
   */
  private async readBackRows(
    clientId: string,
    batchId: string,
  ): Promise<{
    batchRowCount: number
    observationIds: string[]
    successIds: string[]
    evidenceObservationIds: Set<string>
  }> {
    const { data: batchRows, error: batchErr } = await this.sb
      .from(TABLE_BATCHES)
      .select('id')
      .eq('client_id', clientId)
      .eq('id', batchId)
    if (batchErr) fail(`对账读取 ${TABLE_BATCHES}`, batchErr, true)
    if (batchRows === null) throw new GeoStoreError('null_result', '对账读取批次返回 null data 且无 error', true)

    const { data: obsRows, error: obsErr } = await this.sb
      .from(TABLE_OBSERVATIONS)
      .select('id, outcome_ok')
      .eq('client_id', clientId)
      .eq('batch_id', batchId)
    if (obsErr) fail(`对账读取 ${TABLE_OBSERVATIONS}`, obsErr, true)
    if (obsRows === null) throw new GeoStoreError('null_result', '对账读取观测返回 null data 且无 error', true)

    const observationIds = obsRows.map((r) => String((r as { id: unknown }).id))
    const successIds = obsRows
      .filter((r) => (r as { outcome_ok: unknown }).outcome_ok === true)
      .map((r) => String((r as { id: unknown }).id))

    const evidenceObservationIds = new Set<string>()
    for (let i = 0; i < successIds.length; i += EVIDENCE_READBACK_CHUNK) {
      const chunk = successIds.slice(i, i + EVIDENCE_READBACK_CHUNK)
      const { data, error } = await this.sb
        .from(TABLE_EVIDENCE)
        .select('observation_id')
        .eq('client_id', clientId)
        .in('observation_id', chunk)
      if (error) fail(`对账读取 ${TABLE_EVIDENCE}`, error, true)
      if (data === null) throw new GeoStoreError('null_result', '对账读取证据返回 null data 且无 error', true)
      for (const row of data) evidenceObservationIds.add(String((row as { observation_id: unknown }).observation_id))
    }

    return { batchRowCount: batchRows.length, observationIds, successIds, evidenceObservationIds }
  }
}
