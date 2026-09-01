/**
 * Tests for /api/webhooks/whatsapp — the only path inbound WhatsApp messages
 * reach `conversations` / `conversation_messages` through (no polling cron
 * exists for WhatsApp the way `messenger-sync-hourly` does for Messenger —
 * Cloud API has no "list recent messages" endpoint).
 *
 * Coverage mirrors the GitHub webhook test's shape (signature verification is
 * the same class of problem regardless of provider):
 *   1. GET handshake success / wrong token / missing challenge
 *   2. POST invalid signature → 401
 *   3. POST missing META_APP_SECRET → 500
 *   4. POST unmapped phone_number_id → 200 (still ack Meta), message dropped
 *   5. POST valid text message, new contact → conversation created + message inserted
 *   6. POST valid text message, existing conversation → reused, not duplicated
 *   7. POST invalid JSON → 400
 */

import { createHmac } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { GET, POST } from '../route'
import { supabaseAdmin } from '@/lib/supabase'

const mockFrom = vi.mocked(supabaseAdmin.from)
const SECRET = 'test-app-secret'
const VERIFY_TOKEN = 'test-verify-token'
const PHONE_NUMBER_ID = '999888777'
const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'

function sign(body: string): string {
  return 'sha256=' + createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')
}

function makePost(payload: object, opts: { signature?: string | null; rawBody?: string } = {}) {
  const raw = opts.rawBody ?? JSON.stringify(payload)
  const sig = opts.signature !== undefined ? opts.signature : sign(raw)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (sig !== null) headers['x-hub-signature-256'] = sig
  return new NextRequest('https://me.example.com/api/webhooks/whatsapp', {
    method: 'POST',
    headers,
    body: raw,
  })
}

function messagePayload(overrides: Partial<{ waId: string; name: string; body: string; msgId: string }> = {}) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              contacts: [{ wa_id: overrides.waId ?? '64211234567', profile: { name: overrides.name ?? 'Amy' } }],
              messages: [
                {
                  id: overrides.msgId ?? 'wamid.XYZ',
                  from: overrides.waId ?? '64211234567',
                  timestamp: '1788336000',
                  type: 'text',
                  text: { body: overrides.body ?? '请问明天有团吗？' },
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.META_APP_SECRET = SECRET
  process.env.META_VERIFY_TOKEN = VERIFY_TOKEN
})

describe('GET — 订阅握手', () => {
  it('mode/token/challenge 都对 → 原样回传 challenge', async () => {
    const req = new NextRequest(
      `https://me.example.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=abc123`,
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('abc123')
  })

  it('token 不对 → 拒', async () => {
    const req = new NextRequest(
      'https://me.example.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123',
    )
    expect((await GET(req)).status).toBe(403)
  })

  it('没配 META_VERIFY_TOKEN → 500，不是假装验证通过', async () => {
    delete process.env.META_VERIFY_TOKEN
    const req = new NextRequest('https://me.example.com/api/webhooks/whatsapp?hub.mode=subscribe')
    expect((await GET(req)).status).toBe(500)
  })
})

describe('POST — 签名验证', () => {
  it('签名不对 → 401，绝不处理未验证的负载', async () => {
    const res = await POST(makePost(messagePayload(), { signature: 'sha256=' + '0'.repeat(64) }))
    expect(res.status).toBe(401)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('没带签名头 → 401', async () => {
    const res = await POST(makePost(messagePayload(), { signature: null }))
    expect(res.status).toBe(401)
  })

  it('没配 META_APP_SECRET → 500', async () => {
    delete process.env.META_APP_SECRET
    const res = await POST(makePost(messagePayload()))
    expect(res.status).toBe(500)
  })

  it('JSON 解析不了 → 400', async () => {
    const raw = '{not valid json'
    const res = await POST(makePost({}, { rawBody: raw, signature: sign(raw) }))
    expect(res.status).toBe(400)
  })
})

describe('POST — 消息落库', () => {
  function stubDb(opts: { existingConversationId?: string | null; clientMapped?: boolean }) {
    const inserted: Record<string, unknown>[] = []
    const upserted: Record<string, unknown>[] = []
    const convoUpdates: Record<string, unknown>[] = []

    mockFrom.mockImplementation((table: string) => {
      if (table === 'clients') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: opts.clientMapped === false ? null : { id: CLIENT_ID },
              }),
            }),
          }),
        }
      }
      if (table === 'conversations') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({
            data: opts.existingConversationId ? { id: opts.existingConversationId } : null,
          }),
          insert: (payload: Record<string, unknown>) => {
            inserted.push(payload)
            return { select: () => ({ single: async () => ({ data: { id: 'new-convo-id' }, error: null }) }) }
          },
          update: (payload: Record<string, unknown>) => {
            convoUpdates.push(payload)
            return { eq: async () => ({ data: null, error: null }) }
          },
        }
        return chain
      }
      if (table === 'conversation_messages') {
        return {
          upsert: (row: Record<string, unknown>) => {
            upserted.push(row)
            return { data: null, error: null }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    })

    return { inserted, upserted, convoUpdates }
  }

  it('phone_number_id 没映射到任何客户 → 消息丢弃，但仍回 200（不能让 Meta 因此重试轰炸）', async () => {
    const { inserted } = stubDb({ clientMapped: false })
    const res = await POST(makePost(messagePayload()))
    expect(res.status).toBe(200)
    expect(inserted).toHaveLength(0)
  })

  it('新联系人 → 建新会话 + 落一条 inbound 消息', async () => {
    const { inserted, upserted } = stubDb({ existingConversationId: null })
    const res = await POST(makePost(messagePayload({ waId: '64211234567', name: 'Amy', body: '你好' })))

    expect(res.status).toBe(200)
    expect(inserted[0]).toMatchObject({
      client_id: CLIENT_ID,
      channel: 'whatsapp',
      participant_psid: '64211234567',
      participant_name: 'Amy',
    })
    expect(upserted[0]).toMatchObject({
      conversation_id: 'new-convo-id',
      direction: 'inbound',
      body: '你好',
      message_id: 'wamid.XYZ',
    })
  })

  it('已有会话的老联系人再发一条 → 复用会话，不新建', async () => {
    const { inserted, upserted, convoUpdates } = stubDb({ existingConversationId: 'existing-convo' })
    await POST(makePost(messagePayload()))

    expect(inserted).toHaveLength(0)
    expect(upserted[0]).toMatchObject({ conversation_id: 'existing-convo' })
    expect(convoUpdates[0]).toMatchObject({ last_message_from: 'customer' })
  })

  it('用 (conversation_id, message_id) 做 upsert 的 onConflict —— Meta 保证至少送达一次，重复投递不能重复入库', async () => {
    const upsertSpy = vi.fn().mockReturnValue({ data: null, error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'clients') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: CLIENT_ID } }) }) }) }
      if (table === 'conversations') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: { id: 'existing-convo' } }),
          update: () => ({ eq: async () => ({ data: null, error: null }) }),
        }
        return chain
      }
      if (table === 'conversation_messages') return { upsert: upsertSpy }
      throw new Error(`unexpected table ${table}`)
    })

    await POST(makePost(messagePayload()))
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ onConflict: 'conversation_id,message_id' }),
    )
  })
})
