/**
 * POST /api/admin/conversions/nal-mark-won 测试。
 *
 * 重点钉住设计评审揪出来的几个坑：
 *   · 已经在 won 档的联系人再成交一次——CAPI 记录要照常写，不能因为 changed:false 拒收
 *   · 只有邮箱/电话没有 PSID 的联系人也要能成功（子牙评审的匹配键兜底）
 *   · 拒联客户被标成交——记录照写，但响应要如实告知"不会发给广告平台"
 *   · 同一个 idempotencyKey 重复提交——不重复插入
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-admin', () => ({
  guardAdmin: vi.fn(async () => null),
}))
vi.mock('@/lib/conversions/route-guard', () => ({
  guardConversionRoute: vi.fn(async () => ({
    ok: true,
    ctx: { actor: 'fde@example.com', ip: '1.2.3.4', ua: 'test-agent', requestId: 'req-1' },
  })),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'
import { guardConversionRoute } from '@/lib/conversions/route-guard'
import { POST } from './route'

const NAL = '4ae76381-cd45-43bd-85cd-98cfd7604007'
type Row = Record<string, unknown>

let contacts: Row[]
let stages: Row[]
let conversations: Row[]
let touchpoints: Row[]
let outcomes: Row[]
let stageEvents: Row[]
let audits: Row[]

/**
 * 实测核实：`route.ts` 对每张表的调用链都逐一核实过（见各分支注释），假件只按
 * 这些真实调用链建模，不是猜的形状。
 */
function fakeDb(table: string) {
  const filters: Array<[string, unknown]> = []
  const notFilters: Array<[string, unknown]> = []
  let order: [string, boolean] | null = null
  let limitN: number | null = null

  const rowsOf = (): Row[] => {
    const src =
      table === 'contacts'
        ? contacts
        : table === 'client_pipeline_stages'
          ? stages
          : table === 'conversations'
            ? conversations
            : table === 'contact_touchpoints'
              ? touchpoints
              : table === 'me_sale_outcomes'
                ? outcomes
                : []
    let rows = src.filter((r) => filters.every(([c, v]) => r[c] === v))
    for (const [c, v] of notFilters) rows = rows.filter((r) => r[c] !== v && r[c] != null)
    if (order) {
      const [col, asc] = order
      rows = [...rows].sort((a, b) => (asc ? 1 : -1) * String(a[col]).localeCompare(String(b[col])))
    }
    if (limitN != null) rows = rows.slice(0, limitN)
    return rows
  }

  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      filters.push([col, val])
      return builder
    },
    not: (col: string, _op: string, val: unknown) => {
      notFilters.push([col, val])
      return builder
    },
    order: (col: string, opts?: { ascending?: boolean }) => {
      order = [col, opts?.ascending !== false]
      return builder
    },
    limit: (n: number) => {
      limitN = n
      return builder
    },
    maybeSingle: async () => ({ data: rowsOf()[0] ?? null, error: null }),
    update: (patch: Row) => {
      for (const c of contacts) {
        if (filters.every(([col, v]) => c[col] === v)) Object.assign(c, patch)
      }
      return builder
    },
    insert: (row: Row) => {
      if (table === 'me_sale_outcomes') {
        const dup = outcomes.some((r) => r.source_kind === row.source_kind && r.source_ref === row.source_ref)
        if (dup) {
          return {
            select: () => ({
              single: async () => ({ data: null, error: { code: '23505', message: 'duplicate' } }),
            }),
          }
        }
        const id = `outcome-${outcomes.length + 1}`
        outcomes.push({ id, ...row })
        return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) }
      }
      if (table === 'contact_stage_events') {
        stageEvents.push(row)
        return {
          select: () => ({ single: async () => ({ data: { id: 'evt-1' }, error: null }) }),
          then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
        }
      }
      if (table === 'me_conversion_audit') {
        audits.push(row)
        return Promise.resolve({ data: null, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: rowsOf(), error: null }),
  }
  return builder
}

async function markWon(body: unknown) {
  const req = new Request('http://localhost/api/admin/conversions/nal-mark-won', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
  const res = await POST(req)
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  contacts = [
    { id: '11111111-1111-1111-1111-111111111111', client_id: NAL, stage: 'new', primary_email: null, primary_phone: null, do_not_contact: false },
    { id: '22222222-2222-2222-2222-222222222222', client_id: NAL, stage: 'won', primary_email: null, primary_phone: null, do_not_contact: false },
    { id: '33333333-3333-3333-3333-333333333333', client_id: NAL, stage: 'new', primary_email: 'jordan@example.com', primary_phone: null, do_not_contact: false },
    { id: '44444444-4444-4444-4444-444444444444', client_id: NAL, stage: 'new', primary_email: null, primary_phone: null, do_not_contact: true },
  ]
  stages = [{ client_id: NAL, stage_key: 'won' }]
  conversations = [
    { contact_id: '11111111-1111-1111-1111-111111111111', client_id: NAL, participant_psid: 'psid-1', last_message_at: '2026-09-01T00:00:00Z' },
    { contact_id: '22222222-2222-2222-2222-222222222222', client_id: NAL, participant_psid: 'psid-2', last_message_at: '2026-09-01T00:00:00Z' },
    { contact_id: '44444444-4444-4444-4444-444444444444', client_id: NAL, participant_psid: 'psid-4', last_message_at: '2026-09-01T00:00:00Z' },
  ]
  touchpoints = [{ contact_id: '44444444-4444-4444-4444-444444444444', client_id: NAL, occurred_at: '2026-09-01T00:00:00Z', metadata: { do_not_contact: true } }]
  outcomes = []
  stageEvents = []
  audits = []
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(fakeDb)
  vi.mocked(guardAdmin).mockClear()
  vi.mocked(guardConversionRoute).mockClear()
})

describe('POST nal-mark-won', () => {
  it('正常成交：推进阶段、写入 purchase、带上 PSID', async () => {
    const { status, body } = await markWon({
      contactId: '11111111-1111-1111-1111-111111111111',
      amountMajor: 500,
      occurredAt: '2026-09-14T00:00:00Z',
      idempotencyKey: 'req-a',
    })
    expect(status).toBe(200)
    expect(body.stageChanged).toBe(true)
    expect(body.doNotContact).toBe(false)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({
      outcome_kind: 'purchase',
      amount_minor: 50000,
      currency: 'NZD',
      source_kind: 'crm_stage_manual',
      page_scoped_user_id: 'psid-1',
    })
    expect(audits).toHaveLength(1)
  })

  it('已经在 won 档的联系人再成交一次——阶段不变（changed:false），但 CAPI 记录照常写', async () => {
    const { status, body } = await markWon({
      contactId: '22222222-2222-2222-2222-222222222222',
      amountMajor: 300,
      occurredAt: '2026-09-14T00:00:00Z',
      idempotencyKey: 'req-b',
    })
    expect(status).toBe(200)
    expect(body.stageChanged).toBe(false)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0].amount_minor).toBe(30000)
  })

  it('没有 PSID 但有邮箱——匹配键兜底生效，不会被拒收', async () => {
    const { status, body } = await markWon({
      contactId: '33333333-3333-3333-3333-333333333333',
      amountMajor: 200,
      occurredAt: '2026-09-14T00:00:00Z',
      idempotencyKey: 'req-c',
    })
    expect(status).toBe(200)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0].customer_email).toBe('jordan@example.com')
    expect(body.doNotContact).toBe(false)
  })

  it('拒联客户被标成交——记录照写，但如实告知不会发给广告平台', async () => {
    const { status, body } = await markWon({
      contactId: '44444444-4444-4444-4444-444444444444',
      amountMajor: 100,
      occurredAt: '2026-09-14T00:00:00Z',
      idempotencyKey: 'req-d',
    })
    expect(status).toBe(200)
    expect(outcomes).toHaveLength(1)
    expect(body.doNotContact).toBe(true)
    expect(body.message).toContain('拒联')
  })

  it('同一个 idempotencyKey 重复提交——不重复插入', async () => {
    await markWon({ contactId: '11111111-1111-1111-1111-111111111111', amountMajor: 500, occurredAt: '2026-09-14T00:00:00Z', idempotencyKey: 'req-e' })
    const second = await markWon({
      contactId: '11111111-1111-1111-1111-111111111111',
      amountMajor: 500,
      occurredAt: '2026-09-14T00:00:00Z',
      idempotencyKey: 'req-e',
    })
    expect(second.status).toBe(200)
    expect(second.body.alreadyRecorded).toBe(true)
    expect(outcomes).toHaveLength(1)
  })

  it('金额缺失或非法 → 400，不推进阶段、不写库', async () => {
    const { status } = await markWon({ contactId: '11111111-1111-1111-1111-111111111111', amountMajor: -5, occurredAt: '2026-09-14T00:00:00Z', idempotencyKey: 'req-f' })
    expect(status).toBe(400)
    expect(outcomes).toHaveLength(0)
    expect(stageEvents).toHaveLength(0)
  })

  it('缺 idempotencyKey → 400', async () => {
    const { status } = await markWon({ contactId: '11111111-1111-1111-1111-111111111111', amountMajor: 100, occurredAt: '2026-09-14T00:00:00Z' })
    expect(status).toBe(400)
  })
})
