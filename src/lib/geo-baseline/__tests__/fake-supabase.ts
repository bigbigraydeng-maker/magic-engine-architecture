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
  readonly table: string
  readonly op: 'insert' | 'select'
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

  findFailure(table: string, op: 'insert' | 'select'): FakeFailure | undefined {
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
