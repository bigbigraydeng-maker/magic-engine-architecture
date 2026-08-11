/**
 * 假 Supabase —— **按表建模，不按调用次序建模**。
 *
 * 🔴 这条是仓库反复踩出来的教训：按「第 1 次调用返回 A、第 2 次返回 B」写的假件，
 *    实现只要多查一张表就静默错位，错误又被 catch 吞掉，症状指向别处。
 *    这里按表存行、按列过滤，实现改了调用次序也不会假绿。
 *
 * 🔴 **没建模的表直接 throw**，不返回半成品对象。
 * 🔴 建模了 WP03 的三条真实约束（GENERATED 列不可写 / 落库即不可变 / 证据只能挂成功观测），
 *    这样「真实写入必然撞到的问题」在测试里就撞得到。
 */

const MODELLED = new Set(['geo_query_sets', 'geo_queries', 'geo_batches', 'geo_observations', 'geo_evidence'])

export interface FakeFailure {
  /** 表名，或 RPC 名（op='rpc' 时）。 */
  readonly table: string
  readonly op: 'insert' | 'select' | 'rpc'
  readonly message: string
  readonly code?: string
}

type Row = Record<string, unknown>
type Result = { data: Row[] | null; error: { message: string; code?: string } | null }

interface Filter {
  readonly column: string
  readonly kind: 'eq' | 'in'
  readonly value: unknown
}

export class FakeSupabase {
  readonly tables: Record<string, Row[]> = {
    geo_query_sets: [],
    geo_queries: [],
    geo_batches: [],
    geo_observations: [],
    geo_evidence: [],
  }

  /** 注入失败：命中的 (table, op) 直接返回 error。 */
  readonly failures: FakeFailure[] = []
  /** 每一次 insert 的原始 payload —— 断言「GENERATED 列没被写进去」靠它。 */
  readonly insertPayloads: { table: string; rows: Row[] }[] = []
  /** 让「读回来的行」与「写进去的行」脱钩，用来模拟崩溃窗口 / 静默丢行。 */
  readonly swallowInsertsFor = new Set<string>()

  from(table: string): FakeQuery {
    if (!MODELLED.has(table)) {
      throw new Error(`假 Supabase 没有建模表 "${table}" —— 不许返回一个半成品对象假装成功`)
    }
    return new FakeQuery(this, table)
  }

  /**
   * `geo_persist_batch_v1` 的建模 —— **按真事务建模，不是按三次调用建模**。
   *
   * 🔴 全部校验先跑完，全过了才一次性提交到三张表；任一条不过就抛，
   *    **三张表一行都不动**。这正是 plpgsql 函数体的语义：函数内抛错 ⇒ 整个事务回滚。
   *    假件如果做成「边校验边写」，「回滚」这件事就永远测不到。
   */
  rpc(name: string, params: Record<string, unknown>): Promise<Result> {
    if (name !== 'geo_persist_batch_v1') {
      throw new Error(`假 Supabase 没有建模 RPC "${name}" —— 不许返回一个半成品对象假装成功`)
    }
    const injected = this.failures.find((f) => f.table === name && f.op === 'rpc')
    if (injected) return Promise.resolve({ data: null, error: { message: injected.message, code: injected.code } })

    const clientId = String(params.p_client_id)
    const batch = params.p_batch as Row
    const observations = (params.p_observations ?? []) as Row[]
    const evidence = (params.p_evidence ?? []) as Row[]
    this.rpcPayloads.push({ name, params })

    try {
      this.validateTransaction(clientId, batch, observations, evidence)
    } catch (e) {
      // 🔴 抛错 = 回滚。三张表一行都没动过（校验期间从未写入）。
      return Promise.resolve({ data: null, error: { message: (e as Error).message, code: 'P0001' } })
    }

    // 全过了才提交。
    this.tables.geo_batches.push({ ...batch })
    this.tables.geo_observations.push(...observations.map((r) => ({ ...r })))
    this.tables.geo_evidence.push(
      ...evidence.map((r) => ({
        ...r,
        // GENERATED 列由库自己算。
        raw_response_locator:
          r.raw_response === null || r.raw_response === undefined
            ? null
            : `db://public.geo_evidence/${String(r.id)}/raw_response`,
      })),
    )
    return Promise.resolve({
      data: [{ batch_id: batch.id, observations: observations.length, evidence: evidence.length }],
      error: null,
    })
  }

  /** 事务内的全部判据。任一条不过就抛 —— 对应 RPC 里的 `RAISE EXCEPTION`。 */
  private validateTransaction(clientId: string, batch: Row, observations: Row[], evidence: Row[]): void {
    if (batch === undefined || batch === null) throw new Error('p_batch 必须是一个 JSON 对象')
    if (String(batch.client_id) !== clientId) {
      throw new Error(`批次 client_id (${String(batch.client_id)}) 与调用声明的 (${clientId}) 不一致`)
    }
    const batchId = String(batch.id)

    // 租户 / 批次归属
    for (const o of observations) {
      if (String(o.client_id) !== clientId) throw new Error('观测的 client_id 与本批次不符')
      if (String(o.batch_id) !== batchId) throw new Error('观测的 batch_id 与本批次不符')
    }
    for (const e of evidence) {
      if (String(e.client_id) !== clientId) throw new Error('证据的 client_id 与本批次不符')
      // GENERATED 列写入方不许给值
      if ('raw_response_locator' in e) {
        throw new Error('cannot insert a non-DEFAULT value into column "raw_response_locator"')
      }
    }

    // 不可变：同 id 不许再插（含批内自重复）
    const seen = new Set<string>()
    for (const [table, rows] of [
      ['geo_batches', [batch]],
      ['geo_observations', observations],
      ['geo_evidence', evidence],
    ] as const) {
      for (const row of rows) {
        const key = `${table}:${String(row.id)}`
        if (seen.has(key)) throw new Error(`${table} 批内重复 id=${String(row.id)}`)
        seen.add(key)
        if (this.tables[table].some((x) => String(x.id) === String(row.id))) {
          throw new Error(`${table} 已存在 id=${String(row.id)}，不可变行不许重写`)
        }
      }
    }

    // 观测内的维度唯一（idx_geo_observations_no_double_insert）
    const dims = new Set<string>()
    for (const o of observations) {
      const key = [o.query_key, o.engine_family, o.model_version, o.locale, o.market, o.sample_index]
        .map((v) => (v === null || v === undefined ? 'NULL' : `v:${String(v)}`))
        .join('|')
      if (dims.has(key)) throw new Error('同一批次里同一维度组合重复插入')
      dims.add(key)
    }

    // 证据只能挂在**本批次内**的成功观测上（外键 + 触发器）
    const successIds = new Set(observations.filter((o) => o.outcome_ok === true).map((o) => String(o.id)))
    const allIds = new Set(observations.map((o) => String(o.id)))
    for (const e of evidence) {
      const obsId = String(e.observation_id)
      if (!allIds.has(obsId)) throw new Error(`观测 ${obsId} 不存在，挂不上证据`)
      if (!successIds.has(obsId)) throw new Error(`观测 ${obsId} 是失败观测，不能挂证据`)
    }

    // 事务内自检：成功观测必须都有证据
    const withEvidence = new Set(evidence.map((e) => String(e.observation_id)))
    const missing = Array.from(successIds).filter((id) => !withEvidence.has(id))
    if (missing.length > 0) throw new Error(`${missing.length} 条成功观测没有对应证据行，整批回滚`)
  }

  /** 每一次 RPC 的原始 payload —— 断言「GENERATED 列没被送出去」靠它。 */
  readonly rpcPayloads: { name: string; params: Record<string, unknown> }[] = []

  findFailure(table: string, op: 'insert' | 'select' | 'rpc'): FakeFailure | undefined {
    return this.failures.find((f) => f.table === table && f.op === op)
  }

  /** WP03：`raw_response_locator` 是 GENERATED ALWAYS 列，写入方赋值 Postgres 直接拒。 */
  checkGeneratedColumns(table: string, rows: Row[]): FakeFailure | null {
    if (table !== 'geo_evidence') return null
    for (const row of rows) {
      if ('raw_response_locator' in row) {
        return {
          table,
          op: 'insert',
          code: '428C9',
          message: 'cannot insert a non-DEFAULT value into column "raw_response_locator"',
        }
      }
    }
    return null
  }

  /** WP03：证据只能挂在 `outcome_ok = true` 的观测上（触发器 :846-878）。 */
  checkEvidenceOnSuccess(table: string, rows: Row[]): FakeFailure | null {
    if (table !== 'geo_evidence') return null
    for (const row of rows) {
      const obsId = String(row.observation_id)
      const obs = this.tables.geo_observations.find((o) => String(o.id) === obsId)
      if (!obs) {
        return { table, op: 'insert', code: '23503', message: `观测 ${obsId} 不存在，挂不上证据` }
      }
      if (obs.outcome_ok !== true) {
        return { table, op: 'insert', code: '23514', message: `观测 ${obsId} 是失败观测，不能挂证据` }
      }
    }
    return null
  }

  /** WP03：批次 / 观测 / 证据落库即不可变，同 id 不许再插。 */
  checkImmutable(table: string, rows: Row[]): FakeFailure | null {
    if (table === 'geo_query_sets' || table === 'geo_queries') return null
    for (const row of rows) {
      if (row.id !== undefined && this.tables[table].some((e) => String(e.id) === String(row.id))) {
        return { table, op: 'insert', code: '23505', message: `${table} 已存在 id=${String(row.id)}，不可变行不许重写` }
      }
    }
    return null
  }
}

class FakeQuery implements PromiseLike<Result> {
  private readonly filters: Filter[] = []
  private limitN: number | null = null
  private orderColumn: string | null = null
  private orderAscending = true
  private settled: Result | null = null

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}

  insert(payload: Row | Row[]): FakeQuery {
    const rows = Array.isArray(payload) ? payload : [payload]
    this.db.insertPayloads.push({ table: this.table, rows })

    const failure =
      this.db.findFailure(this.table, 'insert') ??
      this.db.checkGeneratedColumns(this.table, rows) ??
      this.db.checkImmutable(this.table, rows) ??
      this.db.checkEvidenceOnSuccess(this.table, rows)

    if (failure) {
      this.settled = { data: null, error: { message: failure.message, code: failure.code } }
      return this
    }
    const stored: Row[] = rows.map((row, i) => ({ id: row.id ?? `gen-${this.db.tables[this.table].length + i}`, ...row }))
    if (!this.db.swallowInsertsFor.has(this.table)) {
      this.db.tables[this.table].push(...stored)
    }
    this.settled = { data: stored, error: null }
    return this
  }

  select(_columns = '*'): FakeQuery {
    return this
  }

  eq(column: string, value: unknown): FakeQuery {
    this.filters.push({ column, kind: 'eq', value })
    return this
  }

  in(column: string, values: unknown[]): FakeQuery {
    this.filters.push({ column, kind: 'in', value: values })
    return this
  }

  limit(n: number): FakeQuery {
    this.limitN = n
    return this
  }

  order(column: string, opts?: { ascending?: boolean }): FakeQuery {
    this.orderColumn = column
    this.orderAscending = opts?.ascending !== false
    return this
  }

  private resolve(): Result {
    if (this.settled) return this.settled
    const injected = this.db.findFailure(this.table, 'select')
    if (injected) return { data: null, error: { message: injected.message, code: injected.code } }

    let rows = this.db.tables[this.table].filter((row) =>
      this.filters.every((f) =>
        f.kind === 'eq'
          ? row[f.column] === f.value
          : Array.isArray(f.value) && (f.value as unknown[]).includes(row[f.column]),
      ),
    )
    if (this.orderColumn !== null) {
      const col = this.orderColumn
      const dir = this.orderAscending ? 1 : -1
      rows = [...rows].sort((a, b) => dir * String(a[col] ?? '').localeCompare(String(b[col] ?? '')))
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN)
    return { data: rows, error: null }
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected)
  }
}
