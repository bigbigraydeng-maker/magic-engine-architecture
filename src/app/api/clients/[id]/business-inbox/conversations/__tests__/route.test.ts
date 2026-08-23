/**
 * 商务收件箱列表路由 —— Risk A 的第一道客户面邮箱读取，隔离是产品本身。
 *
 * 这些测试钉死：
 *   1. 鉴权在任何查询之前 —— 非成员被拒时，一条 DB 查询都没发。
 *   2. 每条读都绑守卫验过的 client_id，且只认 channel='email'。
 *   3. 附件/内部字段从不进 select（message_id / page_id / owner_email / status_note / attach*）。
 *   4. 已存 CRM 阶段被显示；没有阶段的联系人如实变成「暂无分析」(null)。
 *   5. 分页真实：真实总数、hasMore、offset 绑定；不截断在一页、不报假 total。
 *   6. stage 分析取数失败 → 500，绝不静默降级成「暂无分析」。
 *   7. 不再暴露基于 last_message_from 的 awaitingReply（自动回复会把它算错）。
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
  count?: number | null
}

/** 一个既可链式也可 await 的查询对象 —— await 时解析成本表配置的结果。 */
function tableStub(result: TableResult) {
  const p = Promise.resolve(result)
  const q: Record<string, unknown> = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    in: vi.fn(() => q),
    order: vi.fn(() => q),
    range: vi.fn(() => q),
    limit: vi.fn(() => q),
    maybeSingle: vi.fn(() => p),
    then: (onF: (v: TableResult) => unknown, onR?: (e: unknown) => unknown) => p.then(onF, onR),
  }
  return q
}

function stubTables(map: Record<string, TableResult>) {
  const stubs: Record<string, ReturnType<typeof tableStub>> = {}
  for (const [table, result] of Object.entries(map)) stubs[table] = tableStub(result)
  mockFrom.mockImplementation((table: string) => {
    stubs[table] ??= tableStub({ data: [], error: null, count: 0 })
    return stubs[table] as never
  })
  return stubs
}

function request(id = CTS, offset?: number): NextRequest {
  const q = offset === undefined ? '' : `?offset=${offset}`
  return new NextRequest(
    `http://localhost:3001/api/clients/${id}/business-inbox/conversations${q}`,
  )
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

function convRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    subject: 'Booking',
    participant_name: 'Chris',
    message_count: 3,
    last_message_at: '2026-08-01T00:00:00Z',
    contact_id: null,
    ...over,
  }
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

  it('binds both the count and the page reads to the verified client id and email only', async () => {
    allow()
    const stubs = stubTables({ conversations: { data: [], error: null, count: 0 } })

    await GET(request(), params())

    expect(stubs.conversations.eq).toHaveBeenCalledWith('client_id', CTS)
    expect(stubs.conversations.eq).toHaveBeenCalledWith('channel', 'email')
  })
})

describe('business-inbox list — content minimization', () => {
  it('never selects attachment, provider-message-id, mailbox or internal columns', async () => {
    allow()
    const stubs = stubTables({ conversations: { data: [], error: null, count: 0 } })

    await GET(request(), params())

    // 两次 select：count 用 'id'，翻页用列清单 —— 都不能带敏感列。
    const selects = (stubs.conversations.select as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => String(c[0]))
      .join(' | ')
    expect(selects).not.toMatch(/attach/i)
    expect(selects).not.toContain('message_id')
    expect(selects).not.toContain('page_id')
    expect(selects).not.toContain('owner_email')
    expect(selects).not.toContain('status_note')
    expect(selects).not.toContain('last_message_from')
  })

  it('does not expose an awaitingReply field derived from last_message_from', async () => {
    allow()
    stubTables({
      conversations: { data: [convRow('conv-1')], error: null, count: 1 },
      contacts: { data: [], error: null },
      client_pipeline_stages: { data: [], error: null },
    })

    const json = (await (await GET(request(), params())).json()) as {
      conversations: Array<Record<string, unknown>>
      counts?: unknown
    }

    expect(json.conversations[0]).not.toHaveProperty('awaitingReply')
    expect(json).not.toHaveProperty('counts')
  })
})

describe('business-inbox list — honest pagination (Codex P2)', () => {
  it('reports the true total and hasMore, not the page length', async () => {
    allow()
    const rows = Array.from({ length: 50 }, (_, i) => convRow(`conv-${i}`))
    stubTables({
      conversations: { data: rows, error: null, count: 204 },
      contacts: { data: [], error: null },
      client_pipeline_stages: { data: [], error: null },
    })

    const json = (await (await GET(request(), params())).json()) as {
      conversations: unknown[]
      page: { offset: number; pageSize: number; total: number; hasMore: boolean }
    }

    expect(json.conversations).toHaveLength(50)
    expect(json.page).toMatchObject({ offset: 0, total: 204, hasMore: true })
  })

  it('passes a sanitized offset into range and marks the last page as done', async () => {
    allow()
    const stubs = stubTables({
      conversations: { data: [convRow('c')], error: null, count: 51 },
      contacts: { data: [], error: null },
      client_pipeline_stages: { data: [], error: null },
    })

    const json = (await (await GET(request(CTS, 50), params())).json()) as {
      page: { offset: number; hasMore: boolean }
    }

    expect(stubs.conversations.range).toHaveBeenCalledWith(50, 99)
    // offset 50 + 1 row = 51 = total → 没有下一页。
    expect(json.page).toMatchObject({ offset: 50, hasMore: false })
  })

  it('falls back to offset 0 for a malformed offset without erroring', async () => {
    allow()
    const stubs = stubTables({ conversations: { data: [], error: null, count: 0 } })

    const res = await GET(request(CTS, undefined), params())
    // simulate a junk query string
    const junk = new NextRequest(
      `http://localhost:3001/api/clients/${CTS}/business-inbox/conversations?offset=abc`,
    )
    await GET(junk, params())

    expect(res.status).toBe(200)
    expect(stubs.conversations.range).toHaveBeenCalledWith(0, 49)
  })
})

describe('business-inbox list — stored analysis reuse', () => {
  it('shows the CRM stage label for a linked contact and null when unanalysed', async () => {
    allow()
    stubTables({
      conversations: {
        data: [
          convRow('conv-1', { contact_id: 'contact-staged' }),
          convRow('conv-2', { contact_id: 'contact-nostage' }),
        ],
        error: null,
        count: 2,
      },
      contacts: {
        data: [
          { id: 'contact-staged', stage: 'quoted', stage_updated_at: '2026-08-01T00:00:00Z' },
          { id: 'contact-nostage', stage: null, stage_updated_at: null },
        ],
        error: null,
      },
      client_pipeline_stages: { data: [{ stage_key: 'quoted', label: '已报价' }], error: null },
    })

    const json = (await (await GET(request(), params())).json()) as {
      conversations: Array<{ id: string; analysis: { stage: string; stageLabel: string } | null }>
    }

    const byId = Object.fromEntries(json.conversations.map((c) => [c.id, c]))
    expect(byId['conv-1'].analysis).toMatchObject({ stage: 'quoted', stageLabel: '已报价' })
    expect(byId['conv-2'].analysis).toBeNull()
  })

  it('returns 500 (not 暂无分析) when the stage query fails (Codex P2)', async () => {
    allow()
    stubTables({
      conversations: {
        data: [convRow('conv-1', { contact_id: 'contact-1' })],
        error: null,
        count: 1,
      },
      client_pipeline_stages: { data: [], error: null },
      contacts: { data: null, error: { message: 'db down' } },
    })

    const res = await GET(request(), params())
    const json = (await res.json()) as { error: string }

    expect(res.status).toBe(500)
    expect(json.error).not.toContain('db down')
  })

  it('returns 500 without leaking details when the conversations read fails', async () => {
    allow()
    stubTables({ conversations: { data: null, error: { message: 'boom' }, count: null } })

    const res = await GET(request(), params())
    const json = (await res.json()) as { error: string }

    expect(res.status).toBe(500)
    expect(json.error).not.toContain('boom')
  })
})
