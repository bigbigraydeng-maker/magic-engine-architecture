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
        const e = new Error(
          `duplicate key value violates unique constraint "${table}_${keys.join('_')}_key"`,
        ) as Error & { code?: string }
        // Postgres 的唯一约束冲突码。应用层靠它把「正常竞争」跟「真故障」分开。
        e.code = '23505'
        throw e
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

    function run(): { data: unknown; error: { message: string; code?: string } | null } {
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
            const err = e as Error & { code?: string }
            return { data: null, error: { message: err.message, code: err.code } }
          }
          tableOf(table).push(row)
          created.push(row)
        }
        rows = created
      } else if (op === 'update') {
        const target = tableOf(table).filter((r) => matches(r, filters))

        // 复刻 `client_automation_policies_version_guard` 触发器。
        // 🔴 不复刻的话，「政策改了但没人 bump 版本」这条 P1 的测试
        //    测的就只是应用层碰巧写对了，而不是数据库真的强制了。
        if (table === 'client_automation_policies') {
          for (const r of target) {
            if (
              ('client_id' in patch && patch.client_id !== r.client_id) ||
              ('action_key' in patch && patch.action_key !== r.action_key)
            ) {
              return {
                data: null,
                error: {
                  message:
                    'client_automation_policies: client_id / action_key are immutable (insert a new policy row instead)',
                },
              }
            }
          }
        }
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
        for (const r of target) {
          const before = { ...r }
          Object.assign(r, patch)
          if (table === 'client_automation_policies') {
            const authFields = [
              'mode',
              'spend_cap_per_run_usd',
              'spend_cap_per_period_usd',
              'spend_cap_period',
              'decision_ttl_seconds',
              'effective_from',
              'effective_to',
            ]
            const changed = authFields.some((f) => before[f] !== r[f])
            // 调用方传什么 policy_version 都不算数：变了就 +1，没变就保持原值
            r.policy_version = Number(before.policy_version ?? 1) + (changed ? 1 : 0)
            r.updated_at = new Date().toISOString()
          }
        }
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
      onFulfilled: (v: { data: unknown; error: { message: string; code?: string } | null }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => {
      let result: { data: unknown; error: { message: string; code?: string } | null }
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

  /**
   * `kernel_begin_authorized_run` 的内存复刻。
   *
   * 🔴 **整个函数体是同步的**，这一点是故意的：Postgres 那边靠
   *    `FOR UPDATE` 锁 run 来保证「从 authorized 进 running 只发生一次」，
   *    JS 单线程里同步执行给出的是同一个语义 —— 中间不会被另一个
   *    并发调用切进来。只要这里出现一个 `await`，这个复刻就不再等价，
   *    并发测试也就测不到真东西了。
   */
  function beginAuthorizedRun(args: Record<string, unknown>): { ok: boolean; reason: string } {
    const runId = String(args.p_run_id)
    const decisionId = String(args.p_decision_id)
    const workerId = String(args.p_worker_id)
    const no = (reason: string) => ({ ok: false, reason })

    const run = tableOf('action_runs').find((r) => r.id === runId)
    if (!run) return no('run_not_found')
    const decision = tableOf('authorization_decisions').find((d) => d.id === decisionId)
    if (!decision) return no('decision_not_found')

    if (run.status !== 'authorized') return no(`run_not_authorized:${String(run.status)}`)
    if (run.authorization_decision_id !== decisionId) return no('decision_not_current')
    if (decision.action_run_id !== run.id) return no('decision_run_mismatch')

    if (decision.client_id !== run.client_id) return no('cross_client')
    if (decision.action_key !== run.action_key) return no('action_key_mismatch')
    if (decision.action_version !== run.action_version) return no('action_version_mismatch')
    if (decision.idempotency_key !== run.idempotency_key) return no('idempotency_mismatch')

    if (decision.verdict !== 'allow') return no(`not_allow:${String(decision.verdict)}`)
    if (decision.consumed_at) return no('already_consumed')
    if (decision.expires_at && String(decision.expires_at) <= new Date().toISOString()) {
      return no('expired')
    }

    const policy = tableOf('client_automation_policies').find(
      (p) =>
        p.client_id === run.client_id &&
        p.action_key === run.action_key &&
        (p.effective_to === null || p.effective_to === undefined),
    )
    // 🔴 政策被删掉 ≠ 「没有版本号所以随便过」。这正是 P1-1 里最阴的那条路。
    if (!policy) return no('no_active_policy')
    if (policy.policy_version !== decision.policy_version) return no('stale_policy_version')

    const nowIso = new Date().toISOString()
    decision.consumed_at = nowIso
    decision.consumed_by = workerId
    run.status = 'running'
    run.started_at = run.started_at ?? nowIso
    run.last_error = null
    run.updated_at = nowIso
    return { ok: true, reason: 'ok' }
  }

  const client = {
    from,
    /** 只实现 Kernel 真正会调的那两个 RPC。别的名字直接炸。 */
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === 'kernel_begin_authorized_run') {
        return { data: [beginAuthorizedRun(args)], error: null }
      }
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
