/**
 * POST /api/admin/prospecting/discovery-upgrade — unit tests.
 *
 * Scope is deliberately narrow (魏征 P35.14 implementation review): this is
 * the only new code in P35.14 that spends real money and has a status-machine
 * with a bug history (see comments below), so it gets targeted tests. It does
 * NOT re-test runZhangqian or Supabase itself.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-admin', () => ({ guardAdmin: vi.fn().mockResolvedValue(null) }))

const runZhangqianMock = vi.fn()
vi.mock('@/lib/zhangqian/agent', () => ({ runZhangqian: (...a: unknown[]) => runZhangqianMock(...a) }))

let countResult = 0
let rowsResult: Array<{ id: string; domain: string | null; discovery_report_status: string | null }> = []
let claimResult: Array<{ id: string }> | null = [{ id: 'x' }]
let claimErrorResult: { message: string } | null = null
const updates: Array<Record<string, unknown>> = []
// Captures every `.or(...)` filter string passed on an update — this is
// exactly where the null-matching bug and the missing-'truncated' bug lived
// (a plain `.in('col', [null, ...])` never matches NULL rows in PostgREST;
// an allowlist without 'truncated' can never reclaim a truncated run).
const orFilters: string[] = []

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: (_fields: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count) {
          // discoveryAttemptsLast24h() — .select(...).not(...).gte(...)
          return { not: () => ({ gte: () => Promise.resolve({ count: countResult }) }) }
        }
        // row fetch — .select(...).in('id', allowed)
        return { in: () => Promise.resolve({ data: rowsResult, error: null }) }
      },
      update: (payload: Record<string, unknown>) => {
        updates.push(payload)
        const node = {
          eq: () => node,
          or: (filter: string) => { orFilters.push(filter); return { select: () => Promise.resolve({ data: claimResult, error: claimErrorResult }) } },
          then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
        }
        return node
      },
    }),
  },
}))

import { POST } from '../route'

const call = (body: unknown) => POST({ json: () => Promise.resolve(body) } as never)
const VALID_ID = '11111111-2222-3333-4444-555555555555'

beforeEach(() => {
  updates.length = 0
  orFilters.length = 0
  countResult = 0
  rowsResult = [{ id: VALID_ID, domain: 'biz.co.nz', discovery_report_status: null }]
  claimResult = [{ id: VALID_ID }]
  claimErrorResult = null
  runZhangqianMock.mockReset()
  process.env.ANTHROPIC_API_KEY = 'test-key'
})

describe('input validation', () => {
  it('rejects an empty ids array', async () => {
    const res = await call({ ids: [] })
    expect(res.status).toBe(400)
  })

  it('rejects a non-UUID id', async () => {
    const res = await call({ ids: ['not-a-uuid'] })
    expect(res.status).toBe(400)
  })

  it('rejects more than the per-request cap', async () => {
    const ids = Array.from({ length: 11 }, (_, i) => VALID_ID.replace('1111', String(i).padStart(4, '0')))
    const res = await call({ ids })
    expect(res.status).toBe(400)
  })
})

describe('daily cap (魏征 review: a per-request cap alone is not a real spend gate)', () => {
  it('blocks the whole request once the 24h attempt count reaches the cap', async () => {
    countResult = 30 // DAILY_DISCOVERY_CAP
    const res = await call({ ids: [VALID_ID] })
    expect(res.status).toBe(429)
    expect(runZhangqianMock).not.toHaveBeenCalled()
  })

  it('proceeds when under the cap', async () => {
    countResult = 5
    runZhangqianMock.mockResolvedValue({
      report: { meta: { truncated: false, cost_usd: 0.57 } },
      validation_error: null,
    })
    const res = await call({ ids: [VALID_ID] })
    expect(res.status).toBe(200)
    expect(runZhangqianMock).toHaveBeenCalledWith('biz.co.nz')
  })
})

describe('claim filter — the exact bug class found in implementation review', () => {
  it('includes an explicit is.null branch (a plain .in() with null in the array never matches a NULL row in PostgREST)', async () => {
    runZhangqianMock.mockResolvedValue({ report: { meta: { truncated: false, cost_usd: 0.5 } }, validation_error: null })
    await call({ ids: [VALID_ID] })
    expect(orFilters[0]).toContain('discovery_report_status.is.null')
  })

  it('allows reclaiming a truncated run (the first implementation permanently deadlocked these)', async () => {
    runZhangqianMock.mockResolvedValue({ report: { meta: { truncated: false, cost_usd: 0.5 } }, validation_error: null })
    await call({ ids: [VALID_ID] })
    expect(orFilters[0]).toContain('discovery_report_status.eq.truncated')
    expect(orFilters[0]).toContain('discovery_report_status.eq.not_run')
    expect(orFilters[0]).toContain('discovery_report_status.eq.failed')
  })
})

describe('status derivation after a scan', () => {
  it('stores "completed" when the scan finished cleanly', async () => {
    runZhangqianMock.mockResolvedValue({ report: { meta: { truncated: false, cost_usd: 0.57 } }, validation_error: null })
    const res = await call({ ids: [VALID_ID] })
    const json = await res.json()
    expect(json.results[0]).toMatchObject({ status: 'completed' })
    expect(updates.some(u => u.discovery_report_status === 'completed')).toBe(true)
  })

  it('stores "truncated" when the tool-call budget ran out mid-scan', async () => {
    runZhangqianMock.mockResolvedValue({ report: { meta: { truncated: true, cost_usd: 1.5 } }, validation_error: null })
    await call({ ids: [VALID_ID] })
    expect(updates.some(u => u.discovery_report_status === 'truncated')).toBe(true)
  })

  it('stores "failed" when the final JSON failed validation', async () => {
    runZhangqianMock.mockResolvedValue({ report: { meta: { truncated: false, cost_usd: 0.4 } }, validation_error: 'bad json' })
    await call({ ids: [VALID_ID] })
    expect(updates.some(u => u.discovery_report_status === 'failed')).toBe(true)
  })

  it('stores "failed" and never throws when runZhangqian rejects (e.g. Anthropic 5xx)', async () => {
    runZhangqianMock.mockRejectedValue(new Error('upstream 500'))
    const res = await call({ ids: [VALID_ID] })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.results[0]).toMatchObject({ status: 'failed' })
  })
})

describe('pre-claim skip', () => {
  it('skips a prospect already completed without calling runZhangqian', async () => {
    rowsResult = [{ id: VALID_ID, domain: 'biz.co.nz', discovery_report_status: 'completed' }]
    const res = await call({ ids: [VALID_ID] })
    const json = await res.json()
    expect(json.results[0]).toMatchObject({ status: 'skipped' })
    expect(runZhangqianMock).not.toHaveBeenCalled()
  })

  it('skips a prospect with no domain', async () => {
    rowsResult = [{ id: VALID_ID, domain: null, discovery_report_status: null }]
    const res = await call({ ids: [VALID_ID] })
    const json = await res.json()
    expect(json.results[0]).toMatchObject({ status: 'skipped', error: expect.stringContaining('domain') })
  })

  it('skips when the optimistic claim loses to a concurrent run (no error, zero rows — a genuine race)', async () => {
    claimResult = []
    const res = await call({ ids: [VALID_ID] })
    const json = await res.json()
    expect(json.results[0]).toMatchObject({ status: 'skipped', error: expect.stringContaining('concurrent') })
    expect(runZhangqianMock).not.toHaveBeenCalled()
  })

  it('reports "failed" (not "skipped: concurrent run") when the claim query itself errors — found running the real P35.14 pilot: 8 of 18 prospects came back empty-but-no-error was assumed, when the update call had actually failed and left every one of them at NULL, unretried', async () => {
    claimResult = null
    claimErrorResult = { message: 'upstream connection reset' }
    const res = await call({ ids: [VALID_ID] })
    const json = await res.json()
    expect(json.results[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('upstream connection reset') })
    expect(json.results[0].error).not.toMatch(/concurrent/)
    expect(runZhangqianMock).not.toHaveBeenCalled()
  })
})
