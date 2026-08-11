/**
 * Magic Engine 2.0 · GEO Baseline —— 真实 WP03 store（Issue #883 / #917 · WP04A）
 *
 * 实现 WP04 的 `GeoRuntimeStore`（`src/lib/geo-measurement-runtime/types.ts:163-168`）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 关于「原子」这两个字，必须先把话说清楚 —— 这是本文件最重要的一段注释
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WP04 的 store 契约写着「要么整批写入、要么一行都不写」。**走 PostgREST 做不到。**
 * 这不是我的判断，是 WP03 migration 自己写死的：
 *
 *   `20260811000001_me2_geo_measurement_storage_v1.sql:529-534`
 *   「数据库拦不住『成功的观测却没有证据行』：两次 INSERT 经 PostgREST 是两个事务，
 *     跨表的延迟约束在这条路径上根本没有生效的时机。」
 *   同文件 `:897-898`「仍然挡不住…**成功的观测却没有证据行**。」
 *
 * 而写入顺序是被结构钉死的：`geo_observations.batch_id` 外键指向 `geo_batches`，
 * `geo_evidence` 的触发器（`:846-878`）要求观测已存在且 `outcome_ok = true`。
 * ⇒ 必须是三条独立语句，**必然有两个崩溃窗口**。
 *
 * 更要命的是：这三张表的 UPDATE / DELETE 被 `geo_immutable_row`（`:789-819`）全禁，
 * 还有 TRUNCATE 守卫。**半截数据既补不上，也删不掉。补偿性回滚在结构上不可能。**
 *
 * 三条候选路线里选了第三条（本 PR 的技术裁定，理由随 PR 提交给复审）：
 *   ① 新建 Postgres 函数做真事务 —— 需要新 migration + 单独 apply 授权；
 *      而 `migration-shape.test.ts:167-173` 钉死 WP03 那个 migration 不许有
 *      `SECURITY DEFINER`，所以只能另开文件。**首次基线不值得为它引一次不可逆的
 *      生产变更**，且那属于另一个 WP。
 *   ② 直连 `pg` 开事务 —— `pg@^8.20.0` 在 package.json 里但**全仓零 importer**，
 *      也没有任何连接串 env。为一次性脚本引入一条全新的数据库接入方式，
 *      风险大于它解决的问题。
 *   ③ **三条定序 INSERT + 落库后立刻对账 + 不一致就大声失败**（本文件）。
 *
 * 选 ③ 的前提是**把它说出来**：本 store **不提供**原子性，它提供的是
 * **「不原子的时候你一定会知道」**。首次基线是一次有人盯着终端的手工运行，
 * 批次上限 200 条观测、几十秒内跑完 —— 崩溃窗口真实但极窄，且一旦落进去，
 * 抛出来的错会逐字说明哪一批、哪些行成了永久孤儿、以及它删不掉。
 * **绝不静默、绝不假装写成功。**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 **不 import `@/lib/supabase`。** 客户端注入（照 `src/lib/kernel/store.ts:1-18`）。
 * 🔴 **查询失败一律抛错，绝不 `return []`。**「查不到」和「查炸了」返回同一个值，
 *    是这个仓库反复踩的那个坑。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  checkCoverageMatchesRows,
  checkObservationEvidenceIntegrity,
  toGeoBatchRow,
  toGeoEvidenceRow,
  toGeoObservationRow,
} from '@/lib/geo-measurement-runtime'
import type { GeoBatchPersistInput, GeoRuntimeStore } from '@/lib/geo-measurement-runtime'
import type { GeoEvidenceRow } from '@/lib/geo-measurement-store/types'

export const TABLE_BATCHES = 'geo_batches'
export const TABLE_OBSERVATIONS = 'geo_observations'
export const TABLE_EVIDENCE = 'geo_evidence'
export const TABLE_QUERY_SETS = 'geo_query_sets'
export const TABLE_QUERIES = 'geo_queries'

/** 落库过程中出的事。`orphaned` 为真时**已经有行永久留在库里且删不掉**。 */
export class GeoStoreError extends Error {
  readonly code: string
  readonly orphaned: boolean
  constructor(code: string, message: string, orphaned = false) {
    super(message)
    this.name = 'GeoStoreError'
    this.code = code
    this.orphaned = orphaned
  }
}

function fail(op: string, error: { message?: string } | null): never {
  throw new GeoStoreError('query_failed', `[geo-baseline/store] ${op} 失败：${error?.message ?? '未知错误'}`)
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
      toGeoObservationRow({ observation, clientId: input.clientId, createdAt }),
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

    await this.insertBatchRow(batchRow)
    await this.insertObservationRows(observationRows, batchRow.id)
    await this.insertEvidenceRows(evidenceRows, batchRow.id)
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

  /** 第 ① 步：批次终态行。同时触发查询集上锁（migration `:766-783`）。 */
  private async insertBatchRow(batchRow: ReturnType<typeof toGeoBatchRow>): Promise<void> {
    const { error } = await this.sb.from(TABLE_BATCHES).insert(batchRow)
    // 这一步失败 = 一行都没写进去，干净失败，没有孤儿。
    if (error) {
      throw new GeoStoreError(
        'batch_insert_failed',
        `写入 ${TABLE_BATCHES} 失败（未产生任何行）：${error.message}`,
      )
    }
  }

  /** 第 ② 步：整批观测，**单条 SQL 多行插入** —— 这条语句内部 Postgres 保证原子。 */
  private async insertObservationRows(
    rows: readonly ReturnType<typeof toGeoObservationRow>[],
    batchId: string,
  ): Promise<void> {
    if (rows.length === 0) return
    const { error } = await this.sb.from(TABLE_OBSERVATIONS).insert(rows as unknown as object[])
    if (error) {
      throw new GeoStoreError(
        'observations_insert_failed',
        `写入 ${TABLE_OBSERVATIONS} 失败：${error.message}\n` +
          `🔴 批次 ${batchId} 的行已经写进 ${TABLE_BATCHES} 且**不可删除**（geo_immutable_row 触发器）。` +
          `库里现在有一个声称跑过、却没有任何观测的批次。这行永久留存，必须人工登记后忽略；` +
          `重跑请用新批次，不要试图删它 —— 删不掉。`,
        true,
      )
    }
  }

  /** 第 ③ 步：整批证据，同样单条多行插入。GENERATED 列必须摘掉。 */
  private async insertEvidenceRows(
    rows: readonly GeoEvidenceRow[],
    batchId: string,
  ): Promise<void> {
    if (rows.length === 0) return
    const insertable = rows.map(stripGeneratedColumns)
    const { error } = await this.sb.from(TABLE_EVIDENCE).insert(insertable as unknown as object[])
    if (error) {
      throw new GeoStoreError(
        'evidence_insert_failed',
        `写入 ${TABLE_EVIDENCE} 失败：${error.message}\n` +
          `🔴 批次 ${batchId} 的批次行与观测行已经写进库且**不可删除**。` +
          `库里现在有成功观测却没有对应证据 —— 正是 migration :529-534 点名的那种行。` +
          `读的时候 WP02 校验器会当场炸（ok:true 必须带 evidenceId）。必须人工登记，重跑请用新批次。`,
        true,
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
    const { data: obsRows, error: obsErr } = await this.sb
      .from(TABLE_OBSERVATIONS)
      .select('id, outcome_ok')
      .eq('client_id', input.clientId)
      .eq('batch_id', batchId)
    if (obsErr) fail(`对账读取 ${TABLE_OBSERVATIONS}`, obsErr)
    if (obsRows === null) throw new GeoStoreError('null_result', '对账读取观测返回 null data 且无 error')

    const observationIds = obsRows.map((r) => String((r as { id: unknown }).id))
    const successIds = obsRows
      .filter((r) => (r as { outcome_ok: unknown }).outcome_ok === true)
      .map((r) => String((r as { id: unknown }).id))

    const { data: evRows, error: evErr } =
      successIds.length === 0
        ? { data: [] as { observation_id: unknown }[], error: null }
        : await this.sb
            .from(TABLE_EVIDENCE)
            .select('observation_id')
            .eq('client_id', input.clientId)
            .in('observation_id', successIds)
    if (evErr) fail(`对账读取 ${TABLE_EVIDENCE}`, evErr)
    if (evRows === null) throw new GeoStoreError('null_result', '对账读取证据返回 null data 且无 error')

    const actual = input.batch.actualCoverage
    if (observationIds.length !== actual.attempted) {
      throw new GeoStoreError(
        'coverage_row_count_mismatch',
        `🔴 批次 ${batchId} 声称尝试了 ${actual.attempted} 条观测，库里实际只有 ${observationIds.length} 条。` +
          `这些行不可删除，必须人工登记。`,
        true,
      )
    }
    const evidenceObservationIds = new Set(evRows.map((r) => String(r.observation_id)))
    const missing = successIds.filter((id) => !evidenceObservationIds.has(id))
    if (missing.length > 0) {
      throw new GeoStoreError(
        'success_observation_without_evidence',
        `🔴 批次 ${batchId} 有 ${missing.length} 条成功观测在库里没有证据行：${missing.join(', ')}。` +
          `这正是 migration :529-534 说库层拦不住的那种行；它们不可删除，必须人工登记。`,
        true,
      )
    }

    // 覆盖账与真实行数的一致性 —— 复用 WP04 已有的纯判据，不另写一套。
    const coverage = checkCoverageMatchesRows({
      claimedAttempted: actual.attempted,
      claimedSucceeded: actual.succeeded,
      claimedFailed: actual.failed,
      observations: input.observations,
      evidence: input.evidence.map((r) => r.evidence),
    })
    if (!coverage.ok) {
      throw new GeoStoreError(coverage.code, `落库后覆盖账对不上：${coverage.reason}`, true)
    }
  }
}
