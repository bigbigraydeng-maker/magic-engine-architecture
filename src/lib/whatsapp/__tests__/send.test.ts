/**
 * Tests for sending a WhatsApp reply from ME.
 *
 * Mirrors `lib/messenger/__tests__/send.test.ts`'s weighting: isolation,
 * window enforcement, and an audit trail that only exists when the send
 * actually happened. The two differences from that file are structural, not
 * a lighter bar — WhatsApp auth is a single ME-wide token + phone_number_id
 * (env vars, no per-client OAuth lookup) and the window has no 7-day
 * human_agent tier.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { whatsappWindow, sendWhatsApp, CUSTOMER_SERVICE_WINDOW_MS } from '../send'
import { supabaseAdmin } from '@/lib/supabase'

const mockFrom = vi.mocked(supabaseAdmin.from)

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const CONVO = 'convo-uuid'
const WA_ID = '64211234567'

const NOW = new Date('2026-09-02T12:00:00.000Z')

interface Captured {
  auditInserts: Record<string, unknown>[]
  auditUpdates: Record<string, unknown>[]
  messageInserts: Record<string, unknown>[]
  touchpointUpserts: { row: Record<string, unknown>; opts: unknown }[]
}

function stubSupabase(opts: {
  convoClientId?: string | null
  lastInboundAt?: string | null
  psid?: string | null
  channel?: string
  contactId?: string | null
}): Captured {
  const captured: Captured = { auditInserts: [], auditUpdates: [], messageInserts: [], touchpointUpserts: [] }

  mockFrom.mockImplementation((table: string) => {
    let result: unknown = { data: null, error: null }
    let selectingInbound = false

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        if (col === 'direction' && val === 'inbound') selectingInbound = true
        return chain
      },
      order: () => chain,
      limit: () => chain,
      single: async () => result,
      maybeSingle: async () => {
        if (table === 'conversation_messages' && selectingInbound) {
          return { data: opts.lastInboundAt ? { sent_at: opts.lastInboundAt } : null, error: null }
        }
        return result
      },
      insert: (payload: Record<string, unknown>) => {
        if (table === 'conversation_outbound_log') {
          captured.auditInserts.push(payload)
          result = { data: { id: 'audit-1' }, error: null }
        } else if (table === 'conversation_messages') {
          captured.messageInserts.push(payload)
          result = { data: null, error: null }
        }
        return chain
      },
      update: (payload: Record<string, unknown>) => {
        if (table === 'conversation_outbound_log') captured.auditUpdates.push(payload)
        result = { data: null, error: null }
        return chain
      },
      upsert: (row: Record<string, unknown>, upsertOpts: unknown) => {
        if (table === 'contact_touchpoints') captured.touchpointUpserts.push({ row, opts: upsertOpts })
        result = { data: null, error: null }
        return chain
      },
    }

    if (table === 'conversations') {
      result = {
        data:
          opts.convoClientId === null
            ? null
            : {
                id: CONVO,
                client_id: opts.convoClientId ?? CTS,
                channel: opts.channel ?? 'whatsapp',
                participant_psid: opts.psid === undefined ? WA_ID : opts.psid,
                contact_id: opts.contactId === undefined ? 'contact-1' : opts.contactId,
              },
        error: null,
      }
    }

    return chain
  })

  return captured
}

describe('whatsappWindow', () => {
  it('客人没说过话 → 只能发模板，不是「还没试过」', () => {
    expect(whatsappWindow(null, NOW)).toEqual({ kind: 'template_only', msRemaining: 0 })
  })

  it('24 小时内 → 开着，剩余时间算得对', () => {
    const tenHoursAgo = new Date(NOW.getTime() - 10 * 3_600_000).toISOString()
    const win = whatsappWindow(tenHoursAgo, NOW)
    expect(win.kind).toBe('open')
    expect(win.msRemaining).toBe(CUSTOMER_SERVICE_WINDOW_MS - 10 * 3_600_000)
  })

  it('超过 24 小时 → 只能发模板', () => {
    const twentyFiveHoursAgo = new Date(NOW.getTime() - 25 * 3_600_000).toISOString()
    expect(whatsappWindow(twentyFiveHoursAgo, NOW)).toEqual({ kind: 'template_only', msRemaining: 0 })
  })

  it('没有 7 天 human_agent 续期档 —— WhatsApp 没有这一档，跟 Messenger 不同', () => {
    // 6 天前（Messenger 的 human_agent 窗口内，但 WhatsApp 早就该关了）
    const sixDaysAgo = new Date(NOW.getTime() - 6 * 24 * 3_600_000).toISOString()
    expect(whatsappWindow(sixDaysAgo, NOW).kind).toBe('template_only')
  })
})

describe('sendWhatsApp', () => {
  const originalFetch = global.fetch
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-token'
    process.env.WHATSAPP_PHONE_NUMBER_ID = '999888777'
  })

  afterEach(() => {
    vi.useRealTimers()
    global.fetch = originalFetch
    process.env = { ...originalEnv }
    vi.clearAllMocks()
  })

  it('空消息直接拒 —— 不查库、不打 Graph', async () => {
    const res = await sendWhatsApp({
      clientId: CTS,
      conversationId: CONVO,
      body: '   ',
      sentByEmail: 'sales@cts.co.nz',
      usedAiDraft: false,
    })
    expect(res).toMatchObject({ ok: false, reason: 'empty_body' })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('隔离：会话不属于调用方声称的 client_id → 拒', async () => {
    stubSupabase({ convoClientId: OZTOP, lastInboundAt: NOW.toISOString() })
    const res = await sendWhatsApp({
      clientId: CTS,
      conversationId: CONVO,
      body: '你好',
      sentByEmail: 'sales@cts.co.nz',
      usedAiDraft: false,
    })
    expect(res).toMatchObject({ ok: false, reason: 'wrong_client' })
  })

  it('不是 whatsapp 渠道的会话 → 拒，不许拿错渠道的对话去调 Graph', async () => {
    stubSupabase({ channel: 'messenger', lastInboundAt: NOW.toISOString() })
    const res = await sendWhatsApp({
      clientId: CTS,
      conversationId: CONVO,
      body: '你好',
      sentByEmail: 'sales@cts.co.nz',
      usedAiDraft: false,
    })
    expect(res).toMatchObject({ ok: false, reason: 'wrong_channel' })
  })

  it('超过 24 小时窗口 → 拒，且不写审计（还没发就不该留「发过」的痕迹）', async () => {
    const captured = stubSupabase({
      lastInboundAt: new Date(NOW.getTime() - 25 * 3_600_000).toISOString(),
    })
    const res = await sendWhatsApp({
      clientId: CTS,
      conversationId: CONVO,
      body: '你好',
      sentByEmail: 'sales@cts.co.nz',
      usedAiDraft: false,
    })
    expect(res).toMatchObject({ ok: false, reason: 'window_closed' })
    expect(captured.auditInserts).toHaveLength(0)
  })

  it('凭据没配 → 明确说「未配置」，写进审计，不假装发出去了', async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN
    const captured = stubSupabase({ lastInboundAt: NOW.toISOString() })
    const res = await sendWhatsApp({
      clientId: CTS,
      conversationId: CONVO,
      body: '你好',
      sentByEmail: 'sales@cts.co.nz',
      usedAiDraft: false,
    })
    expect(res).toMatchObject({ ok: false, reason: 'no_token' })
    expect(captured.auditUpdates[0]).toMatchObject({ status: 'failed' })
  })

  it('成功路径：Graph 返回 message id → 写审计、写消息、更新会话、记触点', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ messages: [{ id: 'wamid.abc123' }] }),
    }) as unknown as typeof fetch

    const captured = stubSupabase({ lastInboundAt: NOW.toISOString() })
    const res = await sendWhatsApp({
      clientId: CTS,
      conversationId: CONVO,
      body: '你好，请问几点出发？',
      sentByEmail: 'sales@cts.co.nz',
      usedAiDraft: true,
    })

    expect(res).toEqual({ ok: true, whatsappMessageId: 'wamid.abc123', window: 'open' })
    expect(captured.auditInserts[0]).toMatchObject({ used_ai_draft: true, messaging_type: 'open' })
    expect(captured.auditUpdates[0]).toMatchObject({ status: 'sent', meta_message_id: 'wamid.abc123' })
    expect(captured.messageInserts[0]).toMatchObject({ direction: 'outbound', message_id: 'wamid.abc123' })
    expect(captured.touchpointUpserts[0].row).toMatchObject({ channel: 'whatsapp', direction: 'outbound' })

    // Graph 调用打对了号码、带对了 token —— 这是唯一真正会「静默发错」的地方。
    expect(global.fetch).toHaveBeenCalledWith(
      'https://graph.facebook.com/v20.0/999888777/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    )
  })

  it('Graph 拒收 → 明确失败，写审计，不假装发出去了', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":{"message":"Recipient number not in allowed list"}}',
    }) as unknown as typeof fetch

    const captured = stubSupabase({ lastInboundAt: NOW.toISOString() })
    const res = await sendWhatsApp({
      clientId: CTS,
      conversationId: CONVO,
      body: '你好',
      sentByEmail: 'sales@cts.co.nz',
      usedAiDraft: false,
    })
    expect(res).toMatchObject({ ok: false, reason: 'graph_failed' })
    expect(captured.auditUpdates[0]).toMatchObject({ status: 'failed' })
  })
})
