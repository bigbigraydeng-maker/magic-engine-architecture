/**
 * cron_run_logs 写失败必须喊出来（#1428 的下一层问题）。
 *
 * 背景：首版 `startCronRun` 只取 `data` 不取 `error`。insert 一失败 runId 就是 null，
 * `finish()` 里 `if (!runId) return` 直接什么都不干 —— 任务照常跑完、HTTP 200，
 * 但 cron_run_logs 里一行都没有，健康检查反过来把它判成「从来没跑过」。
 * 生产实测：goals-expiry-check 在 GitHub Actions 里天天 success，运行记录却大面积缺失。
 *
 * 假 Supabase 按**表**建模（含 job_name NOT NULL 与 status CHECK 两条真约束），
 * 不按调用次序建模 —— 按次序录制的假客户端只能证明「代码调了这些方法」，
 * 证明不了「写进去的行长对了」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
interface PgError { message: string; code?: string; details?: string | null; hint?: string | null }

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  failInsert: null as PgError | null,
  failUpdate: null as PgError | null,
  insertAttempts: 0,
  updateAttempts: 0,
  seq: 0,
}))

vi.mock('@/lib/supabase', () => {
  const STATUSES = ['running', 'completed', 'failed']

  function from(table: string) {
    if (table !== 'cron_run_logs') throw new Error(`假件只建模了 cron_run_logs，收到 ${table}`)
    let mode: 'select' | 'insert' | 'update' = 'select'
    let payload: Row = {}
    const eqs: Array<[string, unknown]> = []
    const hits = () => state.rows.filter((r) => eqs.every(([c, v]) => r[c] === v))

    function run(): { data: Row[] | null; error: PgError | null } {
      if (mode === 'insert') {
        state.insertAttempts++
        if (state.failInsert) return { data: null, error: state.failInsert }
        // 默认值照 20260606000011_cron_run_logs.sql 的建表 DDL。
        const row: Row = {
          id: `run-${++state.seq}`,
          status: 'running',
          started_at: '2026-01-01T00:00:00.000Z',
          finished_at: null,
          duration_ms: null,
          processed: 0,
          completed_count: 0,
          failed_count: 0,
          summary: null,
          error_message: null,
          ...payload,
        }
        // 真表上的两条约束 —— 少写 job_name 或写错 status，库里是会拒的。
        if (!row.job_name) {
          return { data: null, error: { message: 'null value in column "job_name"', code: '23502' } }
        }
        if (!STATUSES.includes(String(row.status))) {
          return { data: null, error: { message: 'violates check constraint "cron_run_logs_status_check"', code: '23514' } }
        }
        state.rows.push(row)
        return { data: [{ ...row }], error: null }
      }

      if (mode === 'update') {
        state.updateAttempts++
        if (state.failUpdate) return { data: null, error: state.failUpdate }
        const found = hits()
        for (const r of found) Object.assign(r, payload)
        return { data: found.map((r) => ({ ...r })), error: null }
      }

      return { data: hits().map((r) => ({ ...r })), error: null }
    }

    const builder: Record<string, unknown> = {
      select() { return builder },
      insert(p: Row) { mode = 'insert'; payload = p; return builder },
      update(p: Row) { mode = 'update'; payload = p; return builder },
      eq(col: string, val: unknown) { eqs.push([col, val]); return builder },
      single() { const { data, error } = run(); return Promise.resolve({ data: data?.[0] ?? null, error }) },
      then(resolve: (r: { data: Row[] | null; error: PgError | null }) => void) { resolve(run()) },
    }
    return builder
  }

  return { supabaseAdmin: { from } }
})

const { startCronRun } = await import('../run-logger')

/** 把这次测试里 console.error 说过的所有话拼成一段，方便断言「喊了什么」。 */
function said(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
}

beforeEach(() => {
  state.rows = []
  state.failInsert = null
  state.failUpdate = null
  state.insertAttempts = 0
  state.updateAttempts = 0
  state.seq = 0
  vi.restoreAllMocks()
})

describe('startCronRun', () => {
  it('一切正常：一行记录从 running 变成 completed，并且一声不吭', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const run = await startCronRun('demo-job')
    expect(state.rows).toHaveLength(1)
    expect(state.rows[0].job_name).toBe('demo-job')       // 锚点：假件确实被打中了
    expect(state.rows[0].status).toBe('running')

    await run.finish({ processed: 3, completed: 2, failed: 1 })

    expect(state.rows).toHaveLength(1)                     // 收尾是 update，不是再插一行
    expect(state.rows[0].status).toBe('completed')
    expect(state.rows[0].processed).toBe(3)
    expect(state.rows[0].completed_count).toBe(2)
    expect(state.rows[0].failed_count).toBe(1)
    expect(state.rows[0].finished_at).toEqual(expect.any(String))
    expect(spy).not.toHaveBeenCalled()                     // 顺路的时候不许刷屏
  })

  it('任务自己失败：记录落成 failed 并带上原因', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const run = await startCronRun('demo-job')
    await run.finish({ failed: 1, error: 'DataForSEO 超时' })
    expect(state.rows[0].status).toBe('failed')
    expect(state.rows[0].error_message).toBe('DataForSEO 超时')
  })

  it('🔴 开跑记录写不进去：必须喊出来，不许静默返回', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.failInsert = { message: 'permission denied for table cron_run_logs', code: '42501' }

    await startCronRun('goals-expiry-check')

    expect(state.insertAttempts).toBe(1)                   // 锚点：真去写了，不是压根没调
    expect(spy).toHaveBeenCalled()
    const text = said(spy)
    expect(text).toContain('goals-expiry-check')           // 哪个任务
    expect(text).toContain('permission denied for table cron_run_logs') // 错在哪
    expect(text).toContain('42501')
  })

  it('🔴 开跑记录写不进去：finish() 必须补插一条终态记录，发现不许只死在日志里', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    state.failInsert = { message: 'timeout', code: '57014' }

    const run = await startCronRun('goals-expiry-check')
    expect(state.rows).toHaveLength(0)

    state.failInsert = null                                // 收尾时数据库恢复了
    await run.finish({ processed: 7, completed: 7 })

    expect(state.rows).toHaveLength(1)
    expect(state.rows[0].job_name).toBe('goals-expiry-check')
    expect(state.rows[0].status).toBe('completed')         // 不是永远停在 running
    expect(state.rows[0].processed).toBe(7)
    expect(state.rows[0].started_at).toEqual(expect.any(String))
    expect(state.rows[0].finished_at).toEqual(expect.any(String))
  })

  it('补插也失败：再喊一次，并且绝不把正在跑的任务弄挂', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.failInsert = { message: 'permission denied for table cron_run_logs', code: '42501' }

    const run = await startCronRun('goals-expiry-check')
    await expect(run.finish({ processed: 1 })).resolves.toBeUndefined()

    expect(state.insertAttempts).toBe(2)                   // 开跑一次 + 补插一次
    expect(state.rows).toHaveLength(0)
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(said(spy)).toContain('彻底没有痕迹')
  })

  it('🔴 收尾更新写不进去：必须喊，并点明这行会停在 running', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const run = await startCronRun('demo-job')
    state.failUpdate = { message: 'could not serialize access due to concurrent update', code: '40001' }
    await run.finish({ processed: 5 })

    expect(state.updateAttempts).toBe(1)                   // 锚点：真去更新了
    expect(state.rows[0].status).toBe('running')           // 库里确实没被改动
    const text = said(spy)
    expect(text).toContain('demo-job')
    expect(text).toContain('running')
    expect(text).toContain('could not serialize access due to concurrent update')
  })
})
