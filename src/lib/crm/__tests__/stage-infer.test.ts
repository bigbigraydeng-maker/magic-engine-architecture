/**
 * 读往来内容填空着的阶段 —— 取数和落库部分。
 *
 * 这套东西会去动 556 个人的档案，所以三件事必须钉死：
 *   · **只填空的** —— 销售手标过的阶段是最硬的信号，写库那一刻还要再判一次
 *   · **说不出原话就不写** —— 铁律 8，编出来的判断绝不许落到客户档案上
 *   · **留痕** —— 谁填的、为什么、依据哪句话，销售在时间线上看得到
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { inferStagesFromConversations, STAGE_INFER_ACTOR } from '../stage-infer'
import type { StageVerdict } from '../stage-from-conversation'

const NOW = new Date('2026-08-16T00:00:00Z')
const CLIENT = 'client-1'
const CONTACT = 'contact-1'

/** 客人自己说的一句话 —— 模型的证据必须逐字来自它。 */
const CUSTOMER_LINE = 'Could you send me the October itinerary and a price please?'

interface Fake {
  /** 空阶段的候选人。 */
  candidates: { id: string; client_id: string }[]
  /** 这个客户配了哪些阶段。 */
  stages: string[]
  /** 这个人的对话消息。 */
  messages: { direction: 'inbound' | 'outbound'; body: string | null; sent_at: string }[]
  /** UPDATE 命中几行（0 = 有人抢先标过了）。 */
  updated: number
}

let written: { stage?: string; audit?: Record<string, unknown>; guard?: string }

function stubDb(over: Partial<Fake> = {}) {
  const f: Fake = {
    candidates: [{ id: CONTACT, client_id: CLIENT }],
    stages: ['new', 'contacted', 'quoted', 'deferred', 'no_response', 'traveling_soon'],
    messages: [{ direction: 'inbound', body: CUSTOMER_LINE, sent_at: '2026-08-01T00:00:00Z' }],
    updated: 1,
    ...over,
  }
  written = {}

  mocks.from.mockImplementation((table: string) => {
    if (table === 'client_pipeline_stages') {
      // 两个用途共用一张表：先找「配了这些档的客户」，再查某客户配了哪些档。
      const rows = f.stages.map((stage_key) => ({ stage_key, client_id: CLIENT }))
      return {
        select: () => ({
          in: async () => ({ data: f.candidates.length > 0 ? rows : [] }),
          eq: async () => ({ data: rows }),
        }),
      }
    }
    if (table === 'contacts') {
      return {
        select: () => ({
          in: () => ({ is: () => ({ eq: () => ({ limit: async () => ({ data: f.candidates }) }) }) }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: () => ({
            eq: () => ({
              // 记下这道闸真的加在 UPDATE 上了 —— 没有它，取数之后销售手标的
              // 阶段会被这条 UPDATE 直接盖掉。
              is: (col: string, val: unknown) => ({
                select: async () => {
                  written.guard = `${col}=${String(val)}`
                  written.stage = patch.stage as string
                  return { data: f.updated > 0 ? [{ id: CONTACT }] : [], error: null }
                },
              }),
            }),
          }),
        }),
      }
    }
    if (table === 'conversations') {
      return { select: () => ({ eq: () => ({ eq: async () => ({ data: [{ id: 'conv-1' }] }) }) }) }
    }
    if (table === 'conversation_messages') {
      return {
        select: () => ({ in: () => ({ order: () => ({ limit: async () => ({ data: f.messages }) }) }) }),
      }
    }
    if (table === 'contact_touchpoints') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ neq: () => ({ order: () => ({ limit: async () => ({ data: [] }) }) }) }),
          }),
        }),
      }
    }
    // contact_stage_events
    return {
      insert: async (row: Record<string, unknown>) => {
        written.audit = row
        return { error: null }
      },
    }
  })
}

/** 假装模型答了什么。 */
let ask: ReturnType<typeof vi.fn>
function answer(v: { stage: string; evidence: string; reason: string } | null) {
  ask = vi.fn().mockResolvedValue(v as StageVerdict | null)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('OPENAI_API_KEY', 'test-key')
  ask = vi.fn().mockResolvedValue(null)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('没配 key 就一步都不走', () => {
  it('绝不假装读出了什么', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    stubDb()
    const r = await inferStagesFromConversations(NOW, ask)
    expect(r).toEqual({ candidates: 0, asked: 0, filled: 0, rejected: 0, failed: 0 })
    expect(mocks.from).not.toHaveBeenCalled()
  })
})

describe('填空着的阶段', () => {
  it('证据逐字对得上 → 填上，并留一条审计', async () => {
    stubDb()
    answer({ stage: 'quoted', evidence: CUSTOMER_LINE, reason: '客户主动要行程和价格' })

    const r = await inferStagesFromConversations(NOW, ask)
    expect(r.filled).toBe(1)
    expect(written.stage).toBe('quoted')
    expect(written.audit?.changed_by).toBe(STAGE_INFER_ACTOR)
    expect(written.audit?.from_stage).toBeNull()
    expect(written.audit?.to_stage).toBe('quoted')
    // 留痕要说得出理由和原话 —— 销售不服可以直接改。
    expect(String(written.audit?.note)).toContain('客户主动要行程和价格')
    expect(String(written.audit?.note)).toContain('October itinerary')
  })

  it('🔴 证据是编的 → 一个字都不写', async () => {
    stubDb()
    answer({ stage: 'quoted', evidence: 'He said he will pay the deposit tomorrow', reason: '编的' })

    const r = await inferStagesFromConversations(NOW, ask)
    expect(r.rejected).toBe(1)
    expect(r.filled).toBe(0)
    expect(written.stage).toBeUndefined()
    expect(written.audit).toBeUndefined()
  })

  it('🔴 模型想落终结档 → 不接，那个人会从所有名单上消失', async () => {
    stubDb()
    answer({ stage: 'not_interested', evidence: CUSTOMER_LINE, reason: '不该由模型下这种判决' })

    const r = await inferStagesFromConversations(NOW, ask)
    expect(r.rejected).toBe(1)
    expect(written.stage).toBeUndefined()
  })

  it('模型说读不出来 → 继续空着，不是失败', async () => {
    stubDb()
    answer({ stage: 'unclear', evidence: '', reason: '对话太薄' })

    const r = await inferStagesFromConversations(NOW, ask)
    expect(r.filled).toBe(0)
    expect(r.failed).toBe(0)
  })

  it('客户没配这一档 → 不写，界面上不该冒出认不出的阶段', async () => {
    stubDb({ stages: ['new', 'contacted'] })
    answer({ stage: 'quoted', evidence: CUSTOMER_LINE, reason: '这个客户没有报价这一档' })

    const r = await inferStagesFromConversations(NOW, ask)
    expect(r.rejected).toBe(1)
    expect(written.stage).toBeUndefined()
  })
})

describe('绝不覆盖人工判断', () => {
  it('🔴 取数之后销售抢先标了 → UPDATE 命中 0 行，不算填上，也不留假审计', async () => {
    stubDb({ updated: 0 })
    answer({ stage: 'contacted', evidence: CUSTOMER_LINE, reason: '聊上了' })

    const r = await inferStagesFromConversations(NOW, ask)
    expect(r.filled).toBe(0)
    expect(r.failed).toBe(0)
    expect(written.audit).toBeUndefined()
  })

  it('🔴 那道闸必须加在 UPDATE 本身上，不能只靠取数时筛过一遍', async () => {
    stubDb()
    answer({ stage: 'contacted', evidence: CUSTOMER_LINE, reason: '聊上了' })

    await inferStagesFromConversations(NOW, ask)
    expect(written.guard).toBe('stage=null')
  })
})

describe('不值得花的模型调用一次都不花', () => {
  it('对方一个字都没回过 → 不问模型', async () => {
    stubDb({ messages: [{ direction: 'outbound', body: 'Following up on your enquiry', sent_at: '2026-08-01T00:00:00Z' }] })

    const r = await inferStagesFromConversations(NOW, ask)
    expect(r.asked).toBe(0)
    expect(ask).not.toHaveBeenCalled()
  })

  it('一个候选人都没有 → 直接结束', async () => {
    stubDb({ candidates: [] })
    const r = await inferStagesFromConversations(NOW, ask)
    expect(r.asked).toBe(0)
    expect(r.filled).toBe(0)
  })
})
