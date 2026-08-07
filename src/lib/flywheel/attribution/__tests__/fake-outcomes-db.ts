/**
 * Table-modelled Supabase stand-in for the attribution writers.
 *
 * Deliberately NOT a call-order mock. The bug this Work Package fixes lived for
 * months behind a fake that returned a half-built object for every call, so any
 * assertion on "did we end up with the right rows" was vacuous. This fake models
 * the four tables the two writers touch, enforces the real
 * `flywheel_outcomes_natural_key` UNIQUE constraint, and throws loudly on any
 * table nobody has modelled — so a writer that starts reading a new table fails
 * the suite instead of silently getting `[]`.
 */

type Row = Record<string, unknown>

type FilterOp = 'eq' | 'in' | 'lt' | 'lte' | 'gt' | 'gte' | 'notNull'

interface Filter {
  column: string
  op: FilterOp
  value: unknown
}

export interface DbError {
  message: string
}

export interface OpLogEntry {
  table: string
  op: 'select' | 'upsert' | 'insert' | 'delete'
  filters: Filter[]
  rowCount?: number
}

/** Columns of the UNIQUE constraint added by migration 20260808000001. */
export const NATURAL_KEY_COLUMNS = ['action_id', 'metric_key', 'window_days'] as const

const MODELLED_TABLES = [
  'flywheel_actions',
  'flywheel_metrics',
  'flywheel_outcomes',
  'gsc_performance_snapshots',
] as const

type ModelledTable = (typeof MODELLED_TABLES)[number]

export class FakeOutcomesDb {
  private tables = new Map<string, Row[]>()
  private idCounter = 0
  private pendingFailures: Array<{ table: string; op: string; message: string }> = []

  readonly ops: OpLogEntry[] = []

  constructor() {
    for (const t of MODELLED_TABLES) this.tables.set(t, [])
  }

  // ── Seeding / inspection ──────────────────────────────────────────────────

  /**
   * Insert rows without touching the unique constraint. Used to reproduce
   * historical states that the constraint would now reject (e.g. pre-migration
   * duplicate rows).
   */
  seed(table: ModelledTable, rows: Row[]): void {
    const target = this.rowsOf(table)
    for (const row of rows) {
      target.push({ id: row.id ?? this.nextId(), ...row })
    }
  }

  rowsOf(table: ModelledTable): Row[] {
    const rows = this.tables.get(table)
    if (!rows) throw new Error(`FakeOutcomesDb: table "${table}" is not modelled`)
    return rows
  }

  outcomes(): Row[] {
    return this.rowsOf('flywheel_outcomes')
  }

  /** Make the next matching operation return a DB error, once. */
  failNext(table: ModelledTable, op: 'upsert' | 'insert' | 'delete', message: string): void {
    this.pendingFailures.push({ table, op, message })
  }

  didDeleteFrom(table: ModelledTable): boolean {
    return this.ops.some(o => o.table === table && o.op === 'delete')
  }

  // ── Supabase surface ──────────────────────────────────────────────────────

  from(table: string): QueryBuilder {
    if (!this.tables.has(table)) {
      // Fail loudly: an unmodelled table is a hole in the test, not an empty result.
      throw new Error(
        `FakeOutcomesDb: unmodelled table "${table}". Model it before asserting on behaviour.`,
      )
    }
    return new QueryBuilder(this, table)
  }

  // ── Internals used by QueryBuilder ────────────────────────────────────────

  nextId(): string {
    this.idCounter += 1
    return `row-${this.idCounter}`
  }

  takeFailure(table: string, op: string): string | null {
    const idx = this.pendingFailures.findIndex(f => f.table === table && f.op === op)
    if (idx === -1) return null
    return this.pendingFailures.splice(idx, 1)[0].message
  }

  log(entry: OpLogEntry): void {
    this.ops.push(entry)
  }
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every(f => {
    const actual = row[f.column]
    switch (f.op) {
      case 'eq':
        return actual === f.value
      case 'in':
        return (f.value as unknown[]).includes(actual)
      case 'notNull':
        return actual !== null && actual !== undefined
      case 'lt':
        return compare(actual, f.value) < 0
      case 'lte':
        return compare(actual, f.value) <= 0
      case 'gt':
        return compare(actual, f.value) > 0
      case 'gte':
        return compare(actual, f.value) >= 0
    }
  })
}

function compare(a: unknown, b: unknown): number {
  const av = typeof a === 'string' ? Date.parse(a) || a : a
  const bv = typeof b === 'string' ? Date.parse(b) || b : b
  if (typeof av === 'number' && typeof bv === 'number') return av - bv
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

class QueryBuilder implements PromiseLike<{ data: Row[] | null; error: DbError | null }> {
  private filters: Filter[] = []
  private orderBy: { column: string; ascending: boolean } | null = null
  private limitCount: number | null = null
  private mode: 'select' | 'delete' = 'select'

  constructor(
    private db: FakeOutcomesDb,
    private table: string,
  ) {}

  select(): this {
    return this
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, op: 'eq', value })
    return this
  }

  in(column: string, value: unknown[]): this {
    this.filters.push({ column, op: 'in', value })
    return this
  }

  not(column: string, _op: string, _value: unknown): this {
    this.filters.push({ column, op: 'notNull', value: null })
    return this
  }

  lt(column: string, value: unknown): this {
    this.filters.push({ column, op: 'lt', value })
    return this
  }

  lte(column: string, value: unknown): this {
    this.filters.push({ column, op: 'lte', value })
    return this
  }

  gte(column: string, value: unknown): this {
    this.filters.push({ column, op: 'gte', value })
    return this
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: opts?.ascending ?? true }
    return this
  }

  limit(n: number): this {
    this.limitCount = n
    return this
  }

  delete(): this {
    this.mode = 'delete'
    return this
  }

  async maybeSingle(): Promise<{ data: Row | null; error: DbError | null }> {
    const { data, error } = await this.run()
    if (error) return { data: null, error }
    return { data: data?.[0] ?? null, error: null }
  }

  async insert(rows: Row | Row[]): Promise<{ data: null; error: DbError | null }> {
    const failure = this.db.takeFailure(this.table, 'insert')
    if (failure) return { data: null, error: { message: failure } }

    const list = Array.isArray(rows) ? rows : [rows]
    const target = this.db.rowsOf(this.table as ModelledTable)

    for (const row of list) {
      const clash = this.findByNaturalKey(target, row)
      if (clash) {
        return {
          data: null,
          error: {
            message:
              'duplicate key value violates unique constraint "flywheel_outcomes_natural_key"',
          },
        }
      }
      target.push({ id: this.db.nextId(), created_at: new Date().toISOString(), ...row })
    }

    this.db.log({ table: this.table, op: 'insert', filters: [], rowCount: list.length })
    return { data: null, error: null }
  }

  async upsert(
    rows: Row | Row[],
    opts?: { onConflict?: string },
  ): Promise<{ data: null; error: DbError | null }> {
    const failure = this.db.takeFailure(this.table, 'upsert')
    if (failure) return { data: null, error: { message: failure } }

    const conflictCols = (opts?.onConflict ?? '')
      .split(',')
      .map(c => c.trim())
      .filter(Boolean)

    if (this.table === 'flywheel_outcomes' && conflictCols.length === 0) {
      // Without a conflict target PostgREST inserts, which the unique index rejects.
      return {
        data: null,
        error: { message: 'upsert without onConflict target on flywheel_outcomes' },
      }
    }

    const list = Array.isArray(rows) ? rows : [rows]
    const target = this.db.rowsOf(this.table as ModelledTable)

    for (const row of list) {
      const existing = target.find(r => conflictCols.every(c => r[c] === row[c]))
      if (existing) {
        // UPDATE in place: id and created_at survive — that is the whole point.
        Object.assign(existing, row)
      } else {
        target.push({ id: this.db.nextId(), created_at: new Date().toISOString(), ...row })
      }
    }

    this.db.log({ table: this.table, op: 'upsert', filters: [], rowCount: list.length })
    return { data: null, error: null }
  }

  then<TResult1 = { data: Row[] | null; error: DbError | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: Row[] | null; error: DbError | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected)
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  private findByNaturalKey(target: Row[], row: Row): Row | undefined {
    if (this.table !== 'flywheel_outcomes') return undefined
    return target.find(r => NATURAL_KEY_COLUMNS.every(c => r[c] === row[c]))
  }

  private async run(): Promise<{ data: Row[] | null; error: DbError | null }> {
    const target = this.db.rowsOf(this.table as ModelledTable)

    if (this.mode === 'delete') {
      const failure = this.db.takeFailure(this.table, 'delete')
      if (failure) return { data: null, error: { message: failure } }

      const kept = target.filter(r => !matches(r, this.filters))
      const removed = target.length - kept.length
      target.length = 0
      target.push(...kept)
      this.db.log({ table: this.table, op: 'delete', filters: this.filters, rowCount: removed })
      return { data: null, error: null }
    }

    let rows = target.filter(r => matches(r, this.filters))

    if (this.orderBy) {
      const { column, ascending } = this.orderBy
      rows = [...rows].sort((a, b) => {
        const c = compare(a[column], b[column])
        return ascending ? c : -c
      })
    }

    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount)

    this.db.log({ table: this.table, op: 'select', filters: this.filters, rowCount: rows.length })
    return { data: rows, error: null }
  }
}
