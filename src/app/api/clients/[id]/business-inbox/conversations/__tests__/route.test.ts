/**
 * 商务收件箱列表路由 —— Risk A 的第一道客户面邮箱读取，隔离是产品本身。
 *
 * 这些测试钉死四件事：
 *   1. 鉴权在任何查询之前 —— 非成员被拒时，一条 DB 查询都没发。
 *   2. 每条读都绑守卫验过的 client_id，且只认 channel='email'。
 *   3. 附件/内部字段从不进 select（message_id / page_id / owner_email / status_note / attach*）。
 *   4. 已存 CRM 阶段被显示；没有阶段的联系人如实变成「暂无分析」(null)。
 *
 * 假 supabase 按**表**建模（不是按调用次序）：每个查询对象既可链式也可 await，
 * 和 PostgREST 的 builder 一样，改了查询顺序也不会误报绿。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { GET } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockFrom = vi.mocked(supabaseAdmin.from)

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'

interface TableResult {
  data: unknown
  error: unknown
}

/** 一个既可链式也可 await 的查询对象 —— await 时解析成本表配置的结果。 */
function tableStub(result: TableResult) {
  const p = Promise.resolve(result)
  const q: Record<string, unknown> = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    in: vi.fn(() => q),
    order: vi.fn(() => q),
    limit: vi.fn(() => q),
    maybeSingle: vi.fn(() => p),
    then: (onF: (v: TableResult) => unknown, onR?: (e: unknown) => unknown) => p.then(onF, onR),
  }
  return q
}

/** 按表名分发。未配置的表给空结果（不该被查到的表若被查，测试仍可断言）。 */
function stubTables(map: Record<string, TableResult>) {
  const stubs: Record<string, ReturnType<typeof tableStub>> = {}
  for (const [table, result] of Object.entries(map)) {
    stubs[table] = tableStub(result)
  }
  mockFrom.mockImplementation((table: string) => {
    stubs[table] ??= tableStub({ data: [], error: null })
    return stubs[table] as never
  })
  return stubs
}

function request(id = CTS): NextRequest {
  return new NextRequest(`http://localhost:3001/api/clients/${id}/business-inbox/conversations`)
}

function params(id = CTS) {
  return { params: { id } }
}

function allow(clientId = CTS) {
  mockAccess.mockResolvedValue({
    ok: true,
    user: { email: 'bdm@ctstours.co.nz' } as never,
    role: 'client-viewer',
    tier: 'paid_client',
    allowedClientId: clientId,
  } as never)
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.clearAllMocks())

describe('business-inbox list — isolation', () => {
  it('rejects a non-member without ever querying the database', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)

    const res = await GET(request(OZTOP), params(OZTOP))

    expect(res.status).toBe(403)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request without querying', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' } as never)

    const res = await GET(request(), params())

    expect(res.status).toBe(401)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('binds the conversations read to the verified client id and to email only', async () => {
    allow()
    const stubs = stubTables({ conversations: { data: [], error: null } })

    await GET(request(), params())

    expect(stubs.conversations.eq).toHaveBeenCalledWith('client_id', CTS)
    expect(stubs.conversations.eq).toHaveBeenCalledWith('channel', 'email')
  })
})

describe('business-inbox list — content minimization', () => {
  it('never selects attachment, provider-message-id, mailbox or internal columns', async () => {
    allow()
    const stubs = stubTables({ conversations: { data: [], error: null } })

    await GET(request(), params())

    const selected = (stubs.conversations.select as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string
    expect(selected).not.toMatch(/attach/i)
    expect(selected).not.toContain('message_id')
    expect(selected).not.toContain('page_id')
    expect(selected).not.toContain('owner_email')
    expect(selected).not.toContain('status_note')
  })
})

describe('business-inbox list — stored analysis reuse', () => {
  it('shows the CRM stage label for a linked contact and null when unanalysed', async () => {
    allow()
    stubTables({
      conversations: {
        data: [
          {
            id: 'conv-1',
            subject: 'Booking',
            participant_name: 'Chris',
            message_count: 3,
            last_message_at: '2026-08-01T00:00:00Z',
            last_message_from: 'customer',
            contact_id: 'contact-staged',
          },
          {
            id: 'conv-2',
            subject: 'Enquiry',
            participant_name: 'Dana',
            message_count: 1,
            last_message_at: '2026-07-30T00:00:00Z',
            last_message_from: 'page',
            contact_id: 'contact-nostage',
          },
        ],
        error: null,
      },
      contacts: {
        data: [
          { id: 'contact-staged', stage: 'quoted', stage_updated_at: '2026-08-01T00:00:00Z' },
          { id: 'contact-nostage', stage: null, stage_updated_at: null },
        ],
        error: null,
      },
      client_pipeline_stages: {
        data: [{ stage_key: 'quoted', label: '已报价' }],
        error: null,
      },
    })

    const json = (await (await GET(request(), params())).json()) as {
      conversations: Array<{
        id: string
        awaitingReply: boolean
        analysis: { stage: string; stageLabel: string } | null
      }>
      counts: { total: number; awaitingReply: number }
    }

    const byId = Object.fromEntries(json.conversations.map((c) => [c.id, c]))
    expect(byId['conv-1'].analysis).toMatchObject({ stage: 'quoted', stageLabel: '已报价' })
    expect(byId['conv-1'].awaitingReply).toBe(true)
    expect(byId['conv-2'].analysis).toBeNull()
    expect(byId['conv-2'].awaitingReply).toBe(false)
    expect(json.counts).toMatchObject({ total: 2, awaitingReply: 1 })
  })

  it('binds the contacts and stage-label reads to the same verified client id', async () => {
    allow()
    const stubs = stubTables({
      conversations: {
        data: [
          {
            id: 'conv-1',
            subject: null,
            participant_name: null,
            message_count: 1,
            last_message_at: null,
            last_message_from: null,
            contact_id: 'contact-1',
          },
        ],
        error: null,
      },
      contacts: { data: [], error: null },
      client_pipeline_stages: { data: [], error: null },
    })

    await GET(request(), params())

    expect(stubs.contacts.eq).toHaveBeenCalledWith('client_id', CTS)
    expect(stubs.client_pipeline_stages.eq).toHaveBeenCalledWith('client_id', CTS)
  })

  it('returns 500 without leaking details when the conversations read fails', async () => {
    allow()
    stubTables({ conversations: { data: null, error: { message: 'boom' } } })

    const res = await GET(request(), params())
    const json = (await res.json()) as { error: string }

    expect(res.status).toBe(500)
    expect(json.error).not.toContain('boom')
  })
})
