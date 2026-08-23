/**
 * 商务收件箱单条对话路由 —— 最容易泄露「另一个客户存不存在这封邮件」的地方。
 *
 * 钉死：
 *   1. 鉴权在任何查询之前。
 *   2. 非法 id → 404 且不发查询；和「查不到 / 跨租户 / 非邮件」返回同一个 404。
 *   3. 取对话时同时绑 id + client_id + channel='email'；查不到不再查信。
 *   4. 信只 select 最小列，从不含 message_id / 附件字段。
 *   5. 长线程按最新在前取、翻回正序显示 —— 最新邮件永远看得到，更旧的如实标 truncated。
 *   6. stage 分析取数失败 → 500，不静默降级成「暂无分析」。
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
const CONV = 'a1111111-1111-1111-1111-111111111111'

interface TableResult {
  data: unknown
  error: unknown
}

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

function stubTables(map: Record<string, TableResult>) {
  const stubs: Record<string, ReturnType<typeof tableStub>> = {}
  for (const [table, result] of Object.entries(map)) stubs[table] = tableStub(result)
  mockFrom.mockImplementation((table: string) => {
    stubs[table] ??= tableStub({ data: [], error: null })
    return stubs[table] as never
  })
  return stubs
}

function request(id = CTS, conv = CONV): NextRequest {
  return new NextRequest(
    `http://localhost:3001/api/clients/${id}/business-inbox/conversations/${conv}/messages`,
  )
}

function params(id = CTS, conversationId = CONV) {
  return { params: { id, conversationId } }
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

function msg(sentAt: string, over: Record<string, unknown> = {}) {
  return { direction: 'inbound', sender_name: 'Chris', body: 'hi', sent_at: sentAt, ...over }
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.clearAllMocks())

describe('business-inbox detail — auth before query', () => {
  it('rejects a non-member without querying', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)

    const res = await GET(request(OZTOP), params(OZTOP))

    expect(res.status).toBe(403)
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

describe('business-inbox detail — no existence oracle', () => {
  it('returns 404 for a malformed conversation id without querying', async () => {
    allow()
    stubTables({})

    const res = await GET(request(CTS, 'not-a-uuid'), params(CTS, 'not-a-uuid'))

    expect(res.status).toBe(404)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('binds the conversation read to id + client_id + email channel', async () => {
    allow()
    const stubs = stubTables({ conversations: { data: null, error: null } })

    await GET(request(), params())

    expect(stubs.conversations.eq).toHaveBeenCalledWith('id', CONV)
    expect(stubs.conversations.eq).toHaveBeenCalledWith('client_id', CTS)
    expect(stubs.conversations.eq).toHaveBeenCalledWith('channel', 'email')
  })

  it('returns 404 and never reads messages when the conversation is not visible to this client', async () => {
    allow()
    stubTables({ conversations: { data: null, error: null } })

    const res = await GET(request(), params())

    expect(res.status).toBe(404)
    const tablesQueried = mockFrom.mock.calls.map((c) => c[0])
    expect(tablesQueried).toContain('conversations')
    expect(tablesQueried).not.toContain('conversation_messages')
  })
})

describe('business-inbox detail — content minimization', () => {
  it('never selects message_id or attachment columns from messages', async () => {
    allow()
    const stubs = stubTables({
      conversations: {
        data: { id: CONV, subject: 'Booking', participant_name: 'Chris', contact_id: null },
        error: null,
      },
      conversation_messages: { data: [], error: null },
    })

    await GET(request(), params())

    const selected = (stubs.conversation_messages.select as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string
    expect(selected).not.toContain('message_id')
    expect(selected).not.toMatch(/attach/i)
    expect(stubs.conversation_messages.eq).toHaveBeenCalledWith('conversation_id', CONV)
  })

  it('returns the thread oldest-first with minimal fields and the stored analysis', async () => {
    allow()
    // DB 按最新在前返回；路由应翻成正序（旧→新）显示。
    stubTables({
      conversations: {
        data: { id: CONV, subject: 'Booking', participant_name: 'Chris', contact_id: 'contact-1' },
        error: null,
      },
      conversation_messages: {
        data: [
          msg('2026-08-02T00:00:00Z', { body: 'newer' }),
          msg('2026-08-01T00:00:00Z', { body: 'older' }),
        ],
        error: null,
      },
      contacts: {
        data: [{ id: 'contact-1', stage: 'quoted', stage_updated_at: '2026-08-01T00:00:00Z' }],
        error: null,
      },
      client_pipeline_stages: { data: [{ stage_key: 'quoted', label: '已报价' }], error: null },
    })

    const json = (await (await GET(request(), params())).json()) as {
      conversation: { id: string; subject: string | null }
      messages: Array<{ body: string | null }>
      olderTruncated: boolean
      analysis: { stageLabel: string } | null
    }

    expect(json.conversation).toMatchObject({ id: CONV, subject: 'Booking' })
    expect(json.messages.map((m) => m.body)).toEqual(['older', 'newer'])
    expect(Object.keys(json.messages[0]).sort()).toEqual(
      ['body', 'direction', 'senderName', 'sentAt'].sort(),
    )
    expect(json.olderTruncated).toBe(false)
    expect(json.analysis).toMatchObject({ stageLabel: '已报价' })
  })

  it('keeps the newest mail visible and flags truncation on a very long thread (Codex P2)', async () => {
    allow()
    // 201 封（超过上限 200），DB 按最新在前返回。最新那封 sent_at 最大。
    const rowsDesc = Array.from({ length: 201 }, (_, i) =>
      msg(`2026-08-${String(201 - i).padStart(2, '0')}T00:00:00Z`, { body: `m${201 - i}` }),
    )
    stubTables({
      conversations: {
        data: { id: CONV, subject: null, participant_name: null, contact_id: null },
        error: null,
      },
      conversation_messages: { data: rowsDesc, error: null },
    })

    const json = (await (await GET(request(), params())).json()) as {
      messages: Array<{ body: string | null }>
      olderTruncated: boolean
    }

    expect(json.olderTruncated).toBe(true)
    expect(json.messages).toHaveLength(200)
    // 显示的是正序里最后一封 = 最新的 m201；最旧的 m1 被截掉。
    expect(json.messages[json.messages.length - 1].body).toBe('m201')
    expect(json.messages.some((m) => m.body === 'm1')).toBe(false)
  })

  it('reports null analysis when the conversation has no linked contact', async () => {
    allow()
    stubTables({
      conversations: {
        data: { id: CONV, subject: null, participant_name: null, contact_id: null },
        error: null,
      },
      conversation_messages: { data: [], error: null },
    })

    const json = (await (await GET(request(), params())).json()) as { analysis: unknown }

    expect(json.analysis).toBeNull()
  })

  it('returns 500 (not 暂无分析) when the stage query fails (Codex P2)', async () => {
    allow()
    stubTables({
      conversations: {
        data: { id: CONV, subject: null, participant_name: null, contact_id: 'contact-1' },
        error: null,
      },
      conversation_messages: { data: [], error: null },
      client_pipeline_stages: { data: [], error: null },
      contacts: { data: null, error: { message: 'db down' } },
    })

    const res = await GET(request(), params())

    expect(res.status).toBe(500)
  })
})
