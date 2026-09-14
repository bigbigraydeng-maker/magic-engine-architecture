/**
 * 从 CRM 里回邮件。
 *
 * 钉的是三件事：
 *   1. 隔离——conversation 必须真的属于喊它的那个客户，渠道必须真的是邮件
 *   2. 回复用的 id 必须是 createReply 给的真实 id，不能编一个，否则下次
 *      每小时同步会把这封刚发的信当成新信，插出重复的一行
 *   3. 授权/发送失败要翻成人话，且带上「该找谁修」，不是一句「失败了」
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/platform-oauth/token-manager', () => ({
  fetchConnectionRow: vi.fn(),
  getValidTokenForConnection: vi.fn(),
}))

import { supabaseAdmin } from '@/lib/supabase'
import { fetchConnectionRow, getValidTokenForConnection } from '@/lib/platform-oauth/token-manager'
import { sendMailReply } from '../mail-send'

const INPUT = { clientId: 'c1', conversationId: 'cv1', body: '好的，帮您留位', sentByEmail: 'amy@nal.co.nz' }

interface DbOpts {
  conversation?: { id: string; client_id: string; channel: string; contact_id: string | null } | null
  latestMessageId?: string | null
}

let inserted: Record<string, unknown>[]
let touchpointUpserts: Record<string, unknown>[]
let updatedConversation: Record<string, unknown> | null
let auditInserted: Record<string, unknown>[]
let auditUpdates: Record<string, unknown>[]

function mockDb(opts: DbOpts) {
  inserted = []
  touchpointUpserts = []
  updatedConversation = null
  auditInserted = []
  auditUpdates = []
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === 'conversations') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: opts.conversation ?? null }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            updatedConversation = patch
            return { data: null, error: null }
          },
        }),
      }
    }
    if (table === 'conversation_messages') {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data: opts.latestMessageId ? { message_id: opts.latestMessageId } : null,
                }),
              }),
            }),
          }),
        }),
        insert: async (row: Record<string, unknown>) => {
          inserted.push(row)
          return { data: null, error: null }
        },
      }
    }
    if (table === 'contact_touchpoints') {
      return {
        upsert: async (row: Record<string, unknown>) => {
          touchpointUpserts.push(row)
          return { data: null, error: null }
        },
      }
    }
    if (table === 'conversation_outbound_log') {
      return {
        insert: (row: Record<string, unknown>) => {
          auditInserted.push(row)
          return {
            select: () => ({
              single: async () => ({ data: { id: `audit-${auditInserted.length}` } }),
            }),
          }
        },
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            auditUpdates.push(patch)
            return { data: null, error: null }
          },
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
}

function mockGraph(steps: { createReply?: { ok: boolean; status?: number; id?: string }; send?: { ok: boolean; status?: number } }) {
  let call = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      call += 1
      if (String(url).includes('/createReply')) {
        const s = steps.createReply ?? { ok: true, id: 'draft-1' }
        return {
          ok: s.ok,
          status: s.status ?? (s.ok ? 201 : 400),
          json: async () => ({ id: s.id }),
          text: async () => 'createReply failed',
        }
      }
      if (String(url).includes('/send')) {
        const s = steps.send ?? { ok: true }
        return {
          ok: s.ok,
          status: s.status ?? (s.ok ? 202 : 400),
          json: async () => ({}),
          text: async () => 'send failed',
        }
      }
      throw new Error(`unexpected url ${url} (call ${call})`)
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(fetchConnectionRow as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'conn-1' })
  ;(getValidTokenForConnection as ReturnType<typeof vi.fn>).mockResolvedValue('tok-1')
})

afterEach(() => vi.unstubAllGlobals())

describe('回复内容校验', () => {
  it('空内容直接拒绝，不发网络请求', async () => {
    mockDb({})
    const r = await sendMailReply({ ...INPUT, body: '   ' })
    expect(r).toMatchObject({ ok: false, status: 400, reason: 'empty_body' })
  })
})

describe('隔离', () => {
  it('对话不存在 → 404', async () => {
    mockDb({ conversation: null })
    const r = await sendMailReply(INPUT)
    expect(r).toMatchObject({ ok: false, status: 404, reason: 'not_found' })
  })

  it('对话属于别的客户 → 403，绝不跨客户发信', async () => {
    mockDb({ conversation: { id: 'cv1', client_id: 'OTHER', channel: 'email', contact_id: null } })
    const r = await sendMailReply(INPUT)
    expect(r).toMatchObject({ ok: false, status: 403, reason: 'wrong_client' })
  })

  it('不是邮件渠道 → 409，不能拿私信线程去调 Graph', async () => {
    mockDb({ conversation: { id: 'cv1', client_id: 'c1', channel: 'messenger', contact_id: null } })
    const r = await sendMailReply(INPUT)
    expect(r).toMatchObject({ ok: false, status: 409, reason: 'wrong_channel' })
  })

  it('线程里一封信都没有 → 409，没有可回的对象', async () => {
    mockDb({ conversation: { id: 'cv1', client_id: 'c1', channel: 'email', contact_id: null }, latestMessageId: null })
    const r = await sendMailReply(INPUT)
    expect(r).toMatchObject({ ok: false, status: 409, reason: 'no_thread' })
  })
})

describe('授权', () => {
  const convo = { id: 'cv1', client_id: 'c1', channel: 'email', contact_id: 'p1' }

  it('邮箱没连 → 424，说清楚是授权问题', async () => {
    mockDb({ conversation: convo, latestMessageId: 'm-parent' })
    ;(fetchConnectionRow as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'))
    const r = await sendMailReply(INPUT)
    expect(r).toMatchObject({ ok: false, status: 424, reason: 'no_token' })
    expect(r.ok === false && r.error).toContain('授权')
  })

  it('令牌刷新失败 → 424', async () => {
    mockDb({ conversation: convo, latestMessageId: 'm-parent' })
    ;(getValidTokenForConnection as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('refresh failed'))
    const r = await sendMailReply(INPUT)
    expect(r).toMatchObject({ ok: false, status: 424, reason: 'no_token' })
  })
})

describe('发送', () => {
  const convo = { id: 'cv1', client_id: 'c1', channel: 'email', contact_id: 'p1' }

  it('成功 → 用 createReply 给的真实 id，不是编出来的', async () => {
    mockDb({ conversation: convo, latestMessageId: 'm-parent' })
    mockGraph({ createReply: { ok: true, id: 'real-graph-id-9' } })
    const r = await sendMailReply(INPUT)
    expect(r).toMatchObject({ ok: true, messageId: 'real-graph-id-9' })
    expect(inserted[0]).toMatchObject({ conversation_id: 'cv1', message_id: 'real-graph-id-9', direction: 'outbound' })
  })

  it('成功后立刻更新会话的最后消息时间，不等下一次同步', async () => {
    mockDb({ conversation: convo, latestMessageId: 'm-parent' })
    mockGraph({ createReply: { ok: true, id: 'g1' } })
    await sendMailReply(INPUT)
    expect(updatedConversation).toMatchObject({ last_message_from: 'page' })
  })

  it('回信对象已经认了人 → 补一笔触点，幂等键跟同步用的一样', async () => {
    mockDb({ conversation: convo, latestMessageId: 'm-parent' })
    mockGraph({ createReply: { ok: true, id: 'g2' } })
    await sendMailReply(INPUT)
    expect(touchpointUpserts[0]).toMatchObject({
      contact_id: 'p1',
      channel: 'email',
      direction: 'outbound',
      source: 'microsoft_mail',
      source_ref: 'g2',
    })
  })

  it('对话还没认到人 → 不写触点，也不报错', async () => {
    mockDb({ conversation: { ...convo, contact_id: null }, latestMessageId: 'm-parent' })
    mockGraph({ createReply: { ok: true, id: 'g3' } })
    const r = await sendMailReply(INPUT)
    expect(r.ok).toBe(true)
    expect(touchpointUpserts).toHaveLength(0)
  })

  it('建草稿失败 → 502，不假装发出去了', async () => {
    mockDb({ conversation: convo, latestMessageId: 'm-parent' })
    mockGraph({ createReply: { ok: false, status: 400 } })
    const r = await sendMailReply(INPUT)
    expect(r).toMatchObject({ ok: false, status: 502, reason: 'graph_failed' })
    expect(inserted).toHaveLength(0)
  })

  it('草稿建好了但发送那一步失败 → 502，且不写进时间线（没真的发出去）', async () => {
    mockDb({ conversation: convo, latestMessageId: 'm-parent' })
    mockGraph({ createReply: { ok: true, id: 'g4' }, send: { ok: false, status: 500 } })
    const r = await sendMailReply(INPUT)
    expect(r).toMatchObject({ ok: false, status: 502, reason: 'graph_failed' })
    expect(inserted).toHaveLength(0)
  })
})

describe('发送审计（跟私信同一张表、同一个原则）', () => {
  const convo = { id: 'cv1', client_id: 'c1', channel: 'email', contact_id: 'p1' }

  it('调 Graph 之前先插一行 pending —— 中途崩溃也查得出谁试过发', async () => {
    mockDb({ conversation: convo, latestMessageId: 'm-parent' })
    mockGraph({ createReply: { ok: true, id: 'g5' } })
    await sendMailReply(INPUT)
    expect(auditInserted[0]).toMatchObject({
      conversation_id: 'cv1',
      client_id: 'c1',
      sent_by_email: INPUT.sentByEmail,
      status: 'pending',
      messaging_type: 'email',
    })
  })

  it('发成功 → 审计回填成 sent，带上真实的 Graph 消息 id', async () => {
    mockDb({ conversation: convo, latestMessageId: 'm-parent' })
    mockGraph({ createReply: { ok: true, id: 'g6' } })
    await sendMailReply(INPUT)
    expect(auditUpdates[0]).toMatchObject({ status: 'sent', meta_message_id: 'g6' })
  })

  it('建草稿失败 → 审计回填成 failed，带上原因', async () => {
    mockDb({ conversation: convo, latestMessageId: 'm-parent' })
    mockGraph({ createReply: { ok: false, status: 400 } })
    await sendMailReply(INPUT)
    expect(auditUpdates[0]).toMatchObject({ status: 'failed' })
  })

  it('发送那一步失败 → 审计也回填成 failed，不是停在 pending 里', async () => {
    mockDb({ conversation: convo, latestMessageId: 'm-parent' })
    mockGraph({ createReply: { ok: true, id: 'g7' }, send: { ok: false, status: 500 } })
    await sendMailReply(INPUT)
    expect(auditUpdates[0]).toMatchObject({ status: 'failed' })
  })
})
