/**
 * `runNalMessengerLeadSync` 编排层测试——按表建模的假 Supabase（跟
 * `cts-crm-sheet-sync-run.test.ts`/`writeback-service.test.ts` 同一原则：
 * 每张表的假实现都对着源码实际调用链核实过，不是按调用顺序返回预设值）。
 *
 * 🔴 测试用的对话内容是虚构的合成文本，不是真实客户私信原文——跟
 * `nal-messenger-lead-classify.test.ts` 同样的隐私红线。
 */
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runNalMessengerLeadSync } from '../nal-messenger-lead-sync-run'

type Row = Record<string, unknown>

type ConversationSeed = {
  id: string
  contact_id: string | null
  participant_psid: string | null
}

type MessageSeed = {
  conversation_id: string
  message_id: string
  direction: 'inbound' | 'outbound'
  body: string
  sent_at: string
}

function fakeSupabase(seed: { conversations: ConversationSeed[]; messages: MessageSeed[] }): {
  client: SupabaseClient
  outcomes: Row[]
  audits: Row[]
} {
  const outcomes: Row[] = []
  const audits: Row[] = []

  const client = {
    from(table: string) {
      if (table === 'conversations') {
        // 实测核实：nal-messenger-lead-sync-run.ts 对这张表只调用
        // .select('id, contact_id, participant_psid').eq('client_id', ...).eq('channel', 'messenger')，
        // 直接 await（不接 .single()）。
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: seed.conversations, error: null }),
            }),
          }),
        }
      }
      if (table === 'conversation_messages') {
        // 实测核实：只调用
        // .select('message_id, direction, body, sent_at').eq('conversation_id', id).order('sent_at', {ascending: true})。
        return {
          select: () => ({
            eq: (_col: string, convId: string) => ({
              order: async () => ({
                data: seed.messages.filter((m) => m.conversation_id === convId),
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'me_sale_outcomes') {
        // 实测核实：.insert(row).select('id').single()。
        return {
          insert: (row: Row) => ({
            select: () => ({
              single: async () => {
                const dup = outcomes.some(
                  (r) =>
                    r.client_id === row.client_id &&
                    r.source_kind === row.source_kind &&
                    r.source_ref === row.source_ref,
                )
                if (dup) return { data: null, error: { code: '23505', message: 'duplicate key' } }
                const id = `outcome-${outcomes.length + 1}`
                outcomes.push({ id, ...row })
                return { data: { id }, error: null }
              },
            }),
          }),
        }
      }
      if (table === 'me_conversion_audit') {
        // 实测核实：只 `await supabase.from(...).insert({...})`，不接其他方法。
        return {
          insert: async (row: Row) => {
            audits.push(row)
            return { data: null, error: null }
          },
        }
      }
      throw new Error(`unexpected table in test: ${table}`)
    },
  } as unknown as SupabaseClient

  return { client, outcomes, audits }
}

const CONTACT = '11111111-2222-3333-4444-555555555555'
const CONV = 'conv-1'
const PSID = '28681838868174032'

function qualifyingMessages(convId = CONV): MessageSeed[] {
  return [
    {
      conversation_id: convId,
      message_id: 'mid.in1',
      direction: 'inbound',
      body: 'I have 24kg of goods to ship',
      sent_at: '2026-09-01T00:00:00Z',
    },
    {
      conversation_id: convId,
      message_id: 'mid.out1',
      direction: 'outbound',
      body: 'Your shipping cost is NZD 136',
      sent_at: '2026-09-01T01:00:00Z',
    },
  ]
}

describe('runNalMessengerLeadSync', () => {
  it('识别出真商机并写库，带上 contact_id、PSID、幂等键', async () => {
    const { client, outcomes, audits } = fakeSupabase({
      conversations: [{ id: CONV, contact_id: CONTACT, participant_psid: PSID }],
      messages: qualifyingMessages(),
    })

    const summary = await runNalMessengerLeadSync({ supabase: client })

    expect(summary.qualifiedLeadsFound).toBe(1)
    expect(summary.insertedLeads).toBe(1)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({
      client_id: '4ae76381-cd45-43bd-85cd-98cfd7604007',
      contact_id: CONTACT,
      outcome_kind: 'lead',
      source_kind: 'messenger_conversation',
      page_scoped_user_id: PSID,
    })
    expect(audits).toHaveLength(1)
  })

  it('再跑一次同一个人——幂等键命中，不重复写', async () => {
    const { client, outcomes } = fakeSupabase({
      conversations: [{ id: CONV, contact_id: CONTACT, participant_psid: PSID }],
      messages: qualifyingMessages(),
    })

    await runNalMessengerLeadSync({ supabase: client })
    const summary2 = await runNalMessengerLeadSync({ supabase: client })

    expect(summary2.skippedAlreadySynced).toBe(1)
    expect(outcomes).toHaveLength(1)
  })

  it('只是闲聊、没有真实货物信息——不写库', async () => {
    const { client, outcomes } = fakeSupabase({
      conversations: [{ id: CONV, contact_id: CONTACT, participant_psid: PSID }],
      messages: [
        {
          conversation_id: CONV,
          message_id: 'mid.in1',
          direction: 'inbound',
          body: 'Hi, how much does shipping cost?',
          sent_at: '2026-09-01T00:00:00Z',
        },
      ],
    })

    const summary = await runNalMessengerLeadSync({ supabase: client })
    expect(summary.qualifiedLeadsFound).toBe(0)
    expect(outcomes).toHaveLength(0)
  })

  it('没有关联联系人的对话直接跳过，不硬凑一个 contactId', async () => {
    const { client, outcomes } = fakeSupabase({
      conversations: [{ id: CONV, contact_id: null, participant_psid: PSID }],
      messages: qualifyingMessages(),
    })

    const summary = await runNalMessengerLeadSync({ supabase: client })
    expect(summary.totalConversations).toBe(1)
    expect(outcomes).toHaveLength(0)
  })

  it('判定出真商机但这段对话没有 PSID——记进 skippedNoPsid，不硬写一条匹配不上的记录', async () => {
    const { client, outcomes } = fakeSupabase({
      conversations: [{ id: CONV, contact_id: CONTACT, participant_psid: null }],
      messages: qualifyingMessages(),
    })

    const summary = await runNalMessengerLeadSync({ supabase: client })
    expect(summary.qualifiedLeadsFound).toBe(1)
    expect(summary.skippedNoPsid).toBe(1)
    expect(outcomes).toHaveLength(0)
  })

  it('多个联系人各自独立判定、各自写各自的', async () => {
    const { client, outcomes } = fakeSupabase({
      conversations: [
        { id: 'conv-a', contact_id: 'aaaaaaaa-2222-3333-4444-555555555555', participant_psid: 'psid-a' },
        { id: 'conv-b', contact_id: 'bbbbbbbb-2222-3333-4444-555555555555', participant_psid: 'psid-b' },
      ],
      messages: [...qualifyingMessages('conv-a'), ...qualifyingMessages('conv-b')],
    })

    const summary = await runNalMessengerLeadSync({ supabase: client })
    expect(summary.insertedLeads).toBe(2)
    expect(outcomes.map((o) => o.contact_id)).toEqual(
      expect.arrayContaining(['aaaaaaaa-2222-3333-4444-555555555555', 'bbbbbbbb-2222-3333-4444-555555555555']),
    )
  })

  it('达到单次上限后不再继续写，并标记 cappedAtMaxInserts', async () => {
    const { client, outcomes } = fakeSupabase({
      conversations: [
        { id: 'conv-a', contact_id: 'aaaaaaaa-2222-3333-4444-555555555555', participant_psid: 'psid-a' },
        { id: 'conv-b', contact_id: 'bbbbbbbb-2222-3333-4444-555555555555', participant_psid: 'psid-b' },
      ],
      messages: [...qualifyingMessages('conv-a'), ...qualifyingMessages('conv-b')],
    })

    const summary = await runNalMessengerLeadSync({ supabase: client, maxInsertsPerRun: 1 })
    expect(summary.insertedLeads).toBe(1)
    expect(summary.cappedAtMaxInserts).toBe(true)
    expect(outcomes).toHaveLength(1)
  })
})
