/**
 * 内存版 supabase —— **按表建模，不按调用次序建模**。
 *
 * 🔴 这一点是踩出来的：早先的假件按「第 N 次调用返回第 N 份数据」写，
 *    于是被测代码多查一张表就静默拿到半成品对象、错误被 catch 吞掉、
 *    症状指向别处，而测试一直是绿的（同一个毛病让一个 bug 活了两个月）。
 *    所以这里：
 *      ① 数据以表为单位存，过滤是真过滤（eq / in / is / gte / order / limit 都真跑）；
 *      ② **没建模的表直接 throw**，不返回空数组 —— 「查了一张不存在的表」
 *         必须当场炸，不能长得像「这张表是空的」；
 *      ③ 唯一约束和 append-only 触发器都在这里复刻，
 *         因为幂等和审计不可改写恰恰靠它们，只测应用层等于没测。
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type Row = Record<string, unknown>
export type Tables = Record<string, Row[]>

let seq = 0
export function fakeId(prefix = 'id'): string {
  seq += 1
  return `${prefix}-${String(seq).padStart(6, '0')}`
}

/** 复刻生产库上的唯一约束。少了它，幂等测试测的就只是应用层的一个 if。 */
const UNIQUE_KEYS: Record<string, string[][]> = {
  action_runs: [['client_id', 'idempotency_key']],
  action_run_steps: [['run_id', 'step_key']],
}

const DEFAULTS: Record<string, () => Row> = {
  action_runs: () => ({
    status: 'queued',
    goal_id: null,
    execution_item_id: null,
    triggered_by_ref: null,
    input: {},
    rationale: null,
    evidence: {},
    authorization_decision_id: null,
    correlation_id: fakeId('corr'),
    cost_cap_usd: null,
    cost_estimate_usd: null,
    needs_human: false,
    last_error: null,
    started_at: null,
    finished_at: null,
  }),
  action_run_steps: () => ({
    status: 'pending',
    claimed_by: null,
    claimed_at: null,
    heartbeat_at: null,
    attempt: 0,
    reclaim_count: 0,
    next_attempt_at: null,
    output: {},
    verification: null,
    cost_actual_usd: 0,
    last_error: null,
    started_at: null,
    finished_at: null,
  }),
  authorization_decisions: () => ({
    deny_code: null,
    policy_snapshot: {},
    policy_version: null,
    decided_by_user: null,
    cost_cap_usd: null,
    cost_estimate_usd: null,
    expires_at: null,
    consumed_at: null,
    consumed_by: null,
  }),
  production_packages: () => ({
    status: 'draft',
    brief: null,
    source_payload: {},
    generation_context_snapshot: {},
  }),
}

export interface FakeSupabaseOptions {
  /** 让某张表的某种操作报错 —— 用来验证「读炸了」和「读到空」不是同一条分支。 */
  failOn?: Array<{ table: string; op: 'select' | 'insert' | 'update' | 'delete'; message: string }>
  /** 每次操作都记一笔，测试可以断言「这张表被查了几次 / 用什么条件查的」。 */
  log?: Array<{ table: string; op: string; filters: Filter[] }>
}

export interface Filter {
  kind: 'eq' | 'in' | 'is' | 'gte' | 'lte' | 'not'
  column: string
  value: unknown
}

function readPath(row: Row, column: string): unknown {
  // PostgREST 的 JSON 取值语法：source_payload->>kernel_run_id
  if (column.includes('->>')) {
    const [base, key] = column.split('->>')
    const obj = row[base]
    if (obj && typeof obj === 'object') return (obj as Row)[key]
    return undefined
  }
  return row[column]
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    const v = readPath(row, f.column)
    switch (f.kind) {
      case 'eq':
        return v === f.value
      case 'in':
        return Array.isArray(f.value) && (f.value as unknown[]).includes(v)
      case 'is':
        return f.value === null ? v === null || v === undefined : v === f.value
      case 'gte':
        return String(v) >= String(f.value)
      case 'lte':
        return String(v) <= String(f.value)
      case 'not':
        return v !== f.value
      default:
        return true
    }
  })
}

export function createFakeSupabase(
  tables: Tables,
  options: FakeSupabaseOptions = {},
): SupabaseClient {
  const known = new Set(Object.keys(tables))

  function tableOf(name: string): Row[] {
    if (!known.has(name)) {
      // 🔴 不返回 []。查一张没建模的表必须炸 —— 否则「查错了表名」
      //    在测试里长得跟「这张表是空的」一模一样，正是生产上那个 bug 的形状。
      throw new Error(
        `[fake-supabase] 测试没有为表「${name}」建模。要么它不该被查，要么这个测试少准备了数据。`,
      )
    }
    return tables[name]
  }

  function failureFor(table: string, op: string): string | null {
    const hit = (options.failOn ?? []).find((f) => f.table === table && f.op === op)
    return hit ? hit.message : null
  }

  function assertUnique(table: string, row: Row, ignore?: Row): void {
    for (const keys of UNIQUE_KEYS[table] ?? []) {
      const dup = tableOf(table).find(
        (r) => r !== ignore && keys.every((k) => r[k] === row[k]),
      )
      if (dup) {
        throw new Error(
          `duplicate key value violates unique constraint "${table}_${keys.join('_')}_key"`,
        )
      }
    }
  }

  function from(table: string) {
    const filters: Filter[] = []
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
    let payload: Row[] = []
    let patch: Row = {}
    let orderBy: { column: string; ascending: boolean } | null = null
    let limitN: number | null = null
    let wantsReturn = false
    let singleMode: 'single' | 'maybeSingle' | null = null

    const builder: Record<string, unknown> = {}

    const chain = () => builder

    builder.select = (_cols?: string) => {
      if (op === 'select') wantsReturn = true
      else wantsReturn = true
      return chain()
    }
    builder.insert = (rows: Row | Row[]) => {
      op = 'insert'
      payload = Array.isArray(rows) ? rows : [rows]
      return chain()
    }
    builder.update = (p: Row) => {
      op = 'update'
      patch = p
      return chain()
    }
    builder.delete = () => {
      op = 'delete'
      return chain()
    }
    builder.eq = (column: string, value: unknown) => {
      filters.push({ kind: 'eq', column, value })
      return chain()
    }
    builder.in = (column: string, value: unknown[]) => {
      filters.push({ kind: 'in', column, value })
      return chain()
    }
    builder.is = (column: string, value: unknown) => {
      filters.push({ kind: 'is', column, value })
      return chain()
    }
    builder.gte = (column: string, value: unknown) => {
      filters.push({ kind: 'gte', column, value })
      return chain()
    }
    builder.lte = (column: string, value: unknown) => {
      filters.push({ kind: 'lte', column, value })
      return chain()
    }
    builder.not = (column: string, _op: string, value: unknown) => {
      filters.push({ kind: 'not', column, value })
      return chain()
    }
    builder.order = (column: string, opts?: { ascending?: boolean }) => {
      orderBy = { column, ascending: opts?.ascending !== false }
      return chain()
    }
    builder.limit = (n: number) => {
      limitN = n
      return chain()
    }
    builder.single = () => {
      singleMode = 'single'
      return chain()
    }
    builder.maybeSingle = () => {
      singleMode = 'maybeSingle'
      return chain()
    }

    function run(): { data: unknown; error: { message: string } | null } {
      options.log?.push({ table, op, filters: [...filters] })

      const failure = failureFor(table, op)
      if (failure) return { data: null, error: { message: failure } }

      const nowIso = new Date().toISOString()
      let rows: Row[]

      if (op === 'insert') {
        const created: Row[] = []
        for (const raw of payload) {
          const row: Row = {
            id: fakeId(table),
            created_at: nowIso,
            updated_at: nowIso,
            ...(DEFAULTS[table]?.() ?? {}),
            ...raw,
          }
          try {
            assertUnique(table, row)
          } catch (e) {
            return { data: null, error: { message: (e as Error).message } }
          }
          tableOf(table).push(row)
          created.push(row)
        }
        rows = created
      } else if (op === 'update') {
        const target = tableOf(table).filter((r) => matches(r, filters))
        // append-only 触发器的复刻：授权决策只允许把 consumed_at 从空写成一次值
        if (table === 'authorization_decisions') {
          const illegal = Object.keys(patch).filter(
            (k) => k !== 'consumed_at' && k !== 'consumed_by' && k !== 'updated_at',
          )
          if (illegal.length > 0) {
            return {
              data: null,
              error: {
                message: `authorization_decisions is append-only: only consumed_at/consumed_by may be set (tried: ${illegal.join(',')})`,
              },
            }
          }
          const already = target.find((r) => r.consumed_at !== null && r.consumed_at !== undefined)
          if (already) {
            return {
              data: null,
              error: { message: `authorization decision ${already.id} already consumed` },
            }
          }
        }
        for (const r of target) Object.assign(r, patch)
        rows = target
      } else if (op === 'delete') {
        const keep: Row[] = []
        const removed: Row[] = []
        for (const r of tableOf(table)) (matches(r, filters) ? removed : keep).push(r)
        tables[table] = keep
        rows = removed
      } else {
        rows = tableOf(table).filter((r) => matches(r, filters))
        if (orderBy) {
          const { column, ascending } = orderBy
          rows = [...rows].sort((a, b) => {
            const av = readPath(a, column)
            const bv = readPath(b, column)
            const cmp = av === bv ? 0 : (av as never) < (bv as never) ? -1 : 1
            return ascending ? cmp : -cmp
          })
        }
        if (limitN !== null) rows = rows.slice(0, limitN)
      }

      // 返回深拷贝：让被测代码拿到的行改不动内存里的表，
      // 免得「忘了写库」的 bug 因为对象是同一个引用而看起来像成功了。
      const out = rows.map((r) => JSON.parse(JSON.stringify(r)) as Row)

      if (singleMode) {
        if (out.length === 1) return { data: out[0], error: null }
        if (singleMode === 'maybeSingle' && out.length === 0) return { data: null, error: null }
        return { data: null, error: { message: `expected single row, got ${out.length}` } }
      }
      if (op !== 'select' && !wantsReturn) return { data: null, error: null }
      return { data: out, error: null }
    }

    builder.then = (
      onFulfilled: (v: { data: unknown; error: { message: string } | null }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => {
      let result: { data: unknown; error: { message: string } | null }
      try {
        result = run()
      } catch (e) {
        // 🔴 必须**调用** onRejected，不能只 return 一个 rejected promise。
        //    `await thenable` 走的是 `then(resolve, reject)`，它的返回值被丢弃 ——
        //    返回一个没人接的 rejected promise，await 会永远不落地，
        //    错误变成一条 unhandled rejection。（这条是被 store.test.ts 揪出来的。）
        return onRejected ? Promise.resolve(onRejected(e)) : Promise.reject(e)
      }
      return Promise.resolve(result).then(onFulfilled, onRejected)
    }

    return builder
  }

  const client = {
    from,
    /** 只实现 Kernel 真正会调的那一个 RPC。别的名字直接炸。 */
    async rpc(name: string, args: Record<string, unknown>) {
      if (name !== 'kernel_claim_run_step') {
        throw new Error(`[fake-supabase] 没有建模的 RPC：${name}`)
      }
      const workerId = String(args.p_worker_id)
      const clientIds = (args.p_client_ids as string[] | null) ?? null
      const runs = tableOf('action_runs')
      const steps = tableOf('action_run_steps')

      const eligible = steps
        .filter((s) => s.status === 'pending')
        .filter((s) => !s.next_attempt_at || String(s.next_attempt_at) <= new Date().toISOString())
        .filter((s) => !clientIds || clientIds.includes(String(s.client_id)))
        .filter((s) => {
          const run = runs.find((r) => r.id === s.run_id)
          return (
            !!run &&
            (run.status === 'authorized' || run.status === 'running') &&
            run.authorization_decision_id !== null &&
            run.authorization_decision_id !== undefined
          )
        })
        .sort((a, b) => Number(a.step_index) - Number(b.step_index))

      const step = eligible[0]
      if (!step) {
        return { data: [{ ok: false, step_id: null, run_id: null, client_id: null, step_key: null, attempt: null }], error: null }
      }
      step.status = 'claimed'
      step.claimed_by = workerId
      step.claimed_at = new Date().toISOString()
      step.heartbeat_at = step.claimed_at
      step.attempt = Number(step.attempt) + 1
      return {
        data: [
          {
            ok: true,
            step_id: step.id,
            run_id: step.run_id,
            client_id: step.client_id,
            step_key: step.step_key,
            attempt: step.attempt,
          },
        ],
        error: null,
      }
    },
  }

  return client as unknown as SupabaseClient
}
