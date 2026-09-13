/**
 * Tests for brief trigger rules and the no-API-key fallback.
 *
 * shouldGenerateBrief is where the money leaks if it is wrong: without the quiet
 * period and the daily ceiling, a fast back-and-forth re-summarises on every
 * message. Each rule gets a test that fails if the rule is removed.
 *
 * The `generateBrief` describe block below is the regression guard for the
 * 2026-09-13 identity bug: `generateBrief` used to hardcode "CTS Tours New
 * Zealand" and forced travel-agency fields for every client's threads.
 * `brief-cycle.ts:164` never passed a `clientId`, so New Asian Logistics
 * (client_id 4ae76381-cd45-43bd-85cd-98cfd7604007, a logistics company) had
 * every Messenger thread read as if it belonged to CTS Tours, a travel
 * agency. Two real conversations caught it:
 *   - conversation_id 32d8cb65-1a16-4048-9776-b9bc8415c1f4: an inbound
 *     message impersonating a Facebook "verify your account" notice
 *     (unrelated to logistics) got customer_needs hallucinated as
 *     ["了解更多关于中国的旅游信息","希望尽快得到回复"].
 *   - conversation_id f9459c39-8b04-482a-afac-d77fd1bb3fa6: customer said
 *     "Need more information", NAL replied "Hi~How can I help?" — the
 *     generated summary read "客户需要更多信息，CTS询问如何提供帮助",
 *     misattributing NAL's own reply to CTS.
 * Note on the fixtures below: this session has no production database
 * credentials (sandboxed — cannot read .env.local or query Supabase), so the
 * exact literal message bodies could not be pulled to hardcode here. The
 * fixtures reconstruct the reported shape of each conversation instead. A
 * reviewer can confirm the real bodies against `conversation_messages` /
 * `conversation_briefs` for the two conversation_ids above.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Rows keyed by client_id — a fake that is NOT more permissive than the real
 * query. If `loadClientProfile` ever queried the wrong column, or the wrong
 * id got passed down from `brief-cycle.ts`, this returns null (not some
 * other client's row) and the test would fail on a null/generic-name
 * assertion instead of silently passing.
 */
let clientsById: Map<string, { name: string | null; industry: string | null }>
let clientQueryError: string | null = null

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== 'clients') throw new Error(`brief.ts should only query 'clients' here, got '${table}'`)
      return {
        select: () => ({
          eq: (column: string, value: string) => ({
            maybeSingle: () => {
              if (clientQueryError) return Promise.resolve({ data: null, error: { message: clientQueryError } })
              if (column !== 'id') throw new Error(`expected to filter clients by 'id', got '${column}'`)
              return Promise.resolve({ data: clientsById.get(value) ?? null, error: null })
            },
          }),
        }),
      }
    },
  },
}))

/** What the mocked model returns for `client.responses.create(...)` — set per test. */
const mockResponsesCreate = vi.fn()

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    responses: { create: mockResponsesCreate },
  })),
}))

import {
  shouldGenerateBrief,
  fallbackBrief,
  stripMarkdown,
  normaliseFollowUpDueAt,
  buildSystemPrompt,
  isLikelyNoiseMessage,
  generateBrief,
  QUIET_PERIOD_MS,
  MAX_REGENS_PER_DAY,
  type BriefCandidate,
  type StoredMessage,
} from '../brief'

const NOW = new Date('2026-07-26T12:00:00.000Z')
const TODAY = '2026-07-26'

function candidate(over: Partial<BriefCandidate> = {}): BriefCandidate {
  return {
    conversationId: 'conv-1',
    clientId: 'c0000000-0000-0000-0000-000000000000',
    messageCount: 4,
    // Comfortably outside the quiet period.
    lastMessageAt: new Date(NOW.getTime() - QUIET_PERIOD_MS - 60_000).toISOString(),
    existingBriefMessageCount: null,
    regenCount: 0,
    regenCountDate: null,
    ...over,
  }
}

describe('shouldGenerateBrief', () => {
  it('generates for a settled thread with no brief yet', () => {
    expect(shouldGenerateBrief(candidate(), NOW)).toBe(true)
  })

  it('skips an empty thread', () => {
    expect(shouldGenerateBrief(candidate({ messageCount: 0 }), NOW)).toBe(false)
  })

  it('skips a thread with no last-message timestamp', () => {
    expect(shouldGenerateBrief(candidate({ lastMessageAt: null }), NOW)).toBe(false)
  })

  it('waits out the quiet period rather than summarising mid-exchange', () => {
    const stillTalking = candidate({
      lastMessageAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
    })
    expect(shouldGenerateBrief(stillTalking, NOW)).toBe(false)
  })

  it('generates the moment the quiet period is reached', () => {
    const exactly = candidate({
      lastMessageAt: new Date(NOW.getTime() - QUIET_PERIOD_MS).toISOString(),
    })
    expect(shouldGenerateBrief(exactly, NOW)).toBe(true)
  })

  it('skips when the brief already covers every message', () => {
    expect(shouldGenerateBrief(candidate({ existingBriefMessageCount: 4 }), NOW)).toBe(false)
  })

  it('regenerates when the thread has grown since the brief', () => {
    expect(shouldGenerateBrief(candidate({ existingBriefMessageCount: 3 }), NOW)).toBe(true)
  })

  it('stops at the daily ceiling', () => {
    const maxed = candidate({
      existingBriefMessageCount: 3,
      regenCount: MAX_REGENS_PER_DAY,
      regenCountDate: TODAY,
    })
    expect(shouldGenerateBrief(maxed, NOW)).toBe(false)
  })

  it('allows one more below the daily ceiling', () => {
    const under = candidate({
      existingBriefMessageCount: 3,
      regenCount: MAX_REGENS_PER_DAY - 1,
      regenCountDate: TODAY,
    })
    expect(shouldGenerateBrief(under, NOW)).toBe(true)
  })

  it('resets the ceiling on a new day', () => {
    const yesterdayMaxed = candidate({
      existingBriefMessageCount: 3,
      regenCount: MAX_REGENS_PER_DAY,
      regenCountDate: '2026-07-25',
    })
    expect(shouldGenerateBrief(yesterdayMaxed, NOW)).toBe(true)
  })
})

describe('fallbackBrief', () => {
  const messages = [
    {
      direction: 'inbound' as const,
      senderName: 'Sarah',
      body: 'Is the Great Wall included?',
      sentAt: '2026-07-26T09:00:00Z',
    },
    {
      direction: 'outbound' as const,
      senderName: 'CTS',
      body: 'Yes it is.',
      sentAt: '2026-07-26T09:05:00Z',
    },
  ]

  it('never produces a draft the salesperson could send by accident', () => {
    expect(fallbackBrief(messages).draft_reply).toBe('')
  })

  it('flags itself so the card cannot be mistaken for a real summary', () => {
    const brief = fallbackBrief(messages)
    expect(brief.intent_level).toBe('unknown')
    expect(brief.risk_flags.join()).toContain('AI 摘要未生成')
  })

  it('counts only the customer messages', () => {
    expect(fallbackBrief(messages).summary).toContain('客户共发送 1 条消息')
  })

  it('leaves contact empty rather than guessing', () => {
    expect(fallbackBrief(messages).contact).toEqual({ phone: null, email: null })
  })
})

/**
 * Messenger renders markdown literally, and the source threads are full of it
 * (the Meta agent writes `**Best of China**`). Anything reaching a real customer
 * with visible asterisks is a defect, so this is belt-and-braces over the prompt.
 */
describe('stripMarkdown', () => {
  it('unwraps bold', () => {
    expect(stripMarkdown('our **Best of China** tour')).toBe('our Best of China tour')
  })

  it('unwraps italics and code', () => {
    expect(stripMarkdown('a *great* trip with `code`')).toBe('a great trip with code')
    expect(stripMarkdown('an _early_ start')).toBe('an early start')
  })

  it('leaves a lone asterisk and mid-word underscores alone', () => {
    expect(stripMarkdown('5 * 3 seats left')).toBe('5 * 3 seats left')
    expect(stripMarkdown('email best_of_china@example.com')).toBe(
      'email best_of_china@example.com',
    )
  })

  it('is a no-op on plain text', () => {
    const plain = 'Hi Kam, happy to send the full itinerary.'
    expect(stripMarkdown(plain)).toBe(plain)
  })
})

/**
 * follow_up_due_at lands in a TIMESTAMPTZ column. A model that answers with a
 * phrase does not merely look wrong — the INSERT throws and the salesperson
 * gets no card for that thread at all. One bad date must not cost the brief.
 */
describe('normaliseFollowUpDueAt', () => {
  it('keeps a real instant, normalised to ISO', () => {
    expect(normaliseFollowUpDueAt('2026-08-03T21:00:00Z')).toBe('2026-08-03T21:00:00.000Z')
  })

  it('accepts a bare date as that day at midnight UTC', () => {
    expect(normaliseFollowUpDueAt('2026-08-03')).toBe('2026-08-03T00:00:00.000Z')
  })

  it('drops a Chinese phrase instead of letting the whole brief fail to save', () => {
    expect(normaliseFollowUpDueAt('下周三')).toBeNull()
  })

  it('drops an English phrase', () => {
    expect(normaliseFollowUpDueAt('in 3 days')).toBeNull()
  })

  it('drops whitespace-only text', () => {
    expect(normaliseFollowUpDueAt('   ')).toBeNull()
  })

  it('passes null through', () => {
    expect(normaliseFollowUpDueAt(null)).toBeNull()
  })
})

/**
 * buildSystemPrompt is where the identity bug lived: the old SYSTEM_PROMPT
 * constant hardcoded "CTS Tours New Zealand" plus CTS-only facts (25 years
 * of operation, the 1928 disclaimer, "visa-free for 30 days until
 * 2026-12-31", the 0800/ctstours.co.nz contact details) into a prompt every
 * client's threads were sent through.
 */
describe('buildSystemPrompt', () => {
  it('names the real client instead of CTS', () => {
    const prompt = buildSystemPrompt({ name: 'New Asian Logistics', isTourism: false })
    expect(prompt).toContain('New Asian Logistics')
    expect(prompt).not.toContain('CTS')
  })

  it('never hardcodes a CTS-only business fact, even when the client IS CTS', () => {
    // These facts are true for one specific client, not a platform rule — they
    // must come from the thread itself (or a future client knowledge base),
    // never from this shared prompt. See dispatch brief item 2.
    const prompt = buildSystemPrompt({ name: 'CTS Tours NZ', isTourism: true })
    expect(prompt).not.toContain('1928')
    expect(prompt).not.toContain('25 years')
    expect(prompt).not.toContain('30 days')
    expect(prompt).not.toContain('0800 287 888')
    expect(prompt).not.toContain('ctstours.co.nz')
  })

  it('does not ask a non-tourism client to fill in trip fields', () => {
    const prompt = buildSystemPrompt({ name: 'New Asian Logistics', isTourism: false })
    expect(prompt).toMatch(/is not a travel agency/)
    expect(prompt).toMatch(/every field under "trip" must be null/i)
  })

  it('still asks a tourism client to capture trip fields from the customer', () => {
    const prompt = buildSystemPrompt({ name: 'CTS Tours NZ', isTourism: true })
    expect(prompt).toMatch(/sells travel\/tours/)
    expect(prompt).toContain('tour_interest')
  })

  it('always carries the noise/spam guardrail', () => {
    const prompt = buildSystemPrompt({ name: 'New Asian Logistics', isTourism: false })
    expect(prompt).toMatch(/NOISE \/ SPAM/)
  })
})

/**
 * Deterministic backstop for the concrete NAL phishing case — proven without
 * depending on the model getting the prompt instruction right.
 */
describe('isLikelyNoiseMessage', () => {
  it('flags a Facebook-impersonating "verify your account" style ad', () => {
    expect(
      isLikelyNoiseMessage(
        'Your Page has violated our Community Standards. Verify your account within 24 hours or your page will be restricted.',
      ),
    ).toBe(true)
  })

  it('flags a prize/claim style ad', () => {
    expect(isLikelyNoiseMessage("Congratulations, you've won a reward! Claim your prize now.")).toBe(true)
  })

  it('does not flag a genuine customer enquiry', () => {
    expect(isLikelyNoiseMessage('Need more information about your shipping rates to Auckland.')).toBe(false)
    expect(isLikelyNoiseMessage('Is the Great Wall included in the Best of China tour?')).toBe(false)
  })

  it('does not flag a short generic reply', () => {
    expect(isLikelyNoiseMessage('Hi~How can I help?')).toBe(false)
  })

  /** 魏征 review: the original regex required "will be [verb]" with nothing
   * in between, missing the common phishing phrasing with an adverb. */
  it('flags "will be permanently deleted" (adverb between "will be" and the verb)', () => {
    expect(
      isLikelyNoiseMessage('Your page will be permanently deleted if you do not verify now.'),
    ).toBe(true)
  })

  /**
   * 魏征 review: a bare "verify your business" is routine, legitimate B2B
   * text — e.g. a logistics/trade partner confirming registration before
   * signing. It must NOT be flagged just because it mentions verification;
   * only the phishing template (verify + a threat/deadline) should trip.
   */
  it('does not flag a legitimate B2B verification request with no threat or deadline', () => {
    expect(
      isLikelyNoiseMessage('We need to verify your business registration before signing the contract.'),
    ).toBe(false)
  })

  it('still flags the phishing template: verify + a threat/deadline together', () => {
    expect(
      isLikelyNoiseMessage('Verify your business account within 24 hours or it will be suspended.'),
    ).toBe(true)
  })
})

/**
 * Regression guard for the 2026-09-13 identity bug (see file header). Every
 * case here goes through the real `generateBrief`, with only Supabase and
 * the OpenAI client mocked — the client-name lookup, prompt construction,
 * noise detection and trip-nulling all run for real.
 */
describe('generateBrief — client identity and content guardrails', () => {
  const NAL_CLIENT_ID = '4ae76381-cd45-43bd-85cd-98cfd7604007'
  const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'

  function modelReturns(overrides: Record<string, unknown> = {}): void {
    mockResponsesCreate.mockResolvedValue({
      output_text: JSON.stringify({
        summary: '摘要',
        intent_level: 'medium',
        customer_needs: [],
        objections: [],
        promises_made: [],
        next_action: null,
        follow_up_due_at: null,
        risk_flags: [],
        trip: {
          tour_interest: null,
          travel_window: null,
          party_size: null,
          departure_city: null,
          first_time_to_china: null,
          budget_signal: null,
        },
        contact: { phone: null, email: null },
        draft_reply: 'Thanks for reaching out — someone will follow up shortly.',
        ...overrides,
      }),
    })
  }

  beforeEach(() => {
    // vitest.setup.ts already sets a dummy OPENAI_API_KEY globally; restate it
    // here so this suite does not depend on that global staying in place.
    process.env.OPENAI_API_KEY = 'test-openai-key'
    clientsById = new Map()
    clientQueryError = null
    mockResponsesCreate.mockReset()
  })

  /**
   * Reconstructed from conversation_id 32d8cb65-1a16-4048-9776-b9bc8415c1f4
   * (New Asian Logistics) — a single inbound message impersonating a
   * Facebook account-verification notice, unrelated to logistics. The real
   * generated card hallucinated customer_needs as
   * ["了解更多关于中国的旅游信息","希望尽快得到回复"]. This test proves that
   * even if the model repeats that exact hallucination, our post-processing
   * discards it — the guardrail does not depend on the model behaving.
   */
  it('discards hallucinated needs for a phishing/ad thread, even if the model invents them', async () => {
    clientsById.set(NAL_CLIENT_ID, { name: 'New Asian Logistics', industry: 'logistics' })
    const messages: StoredMessage[] = [
      {
        direction: 'inbound',
        senderName: 'Meta for Business',
        body: 'Your Page has been reported for violating our Community Standards. Verify your business account within 24 hours to avoid restriction.',
        sentAt: '2026-09-10T02:00:00Z',
      },
    ]
    modelReturns({
      customer_needs: ['了解更多关于中国的旅游信息', '希望尽快得到回复'],
      intent_level: 'medium',
      trip: { tour_interest: 'Best of China', travel_window: null, party_size: null, departure_city: null, first_time_to_china: null, budget_signal: null },
    })

    const brief = await generateBrief(messages, NAL_CLIENT_ID)

    expect(brief.customer_needs).toEqual([])
    expect(brief.intent_level).toBe('unknown')
    expect(brief.risk_flags.some((f) => f.includes('钓鱼') || f.includes('垃圾'))).toBe(true)
    // Non-tourism client: trip must stay empty no matter what the model returned.
    expect(brief.trip).toEqual({
      tour_interest: null,
      travel_window: null,
      party_size: null,
      departure_city: null,
      first_time_to_china: null,
      budget_signal: null,
    })
  })

  /**
   * Reconstructed from conversation_id f9459c39-8b04-482a-afac-d77fd1bb3fa6
   * (New Asian Logistics) — customer says "Need more information", NAL
   * replies "Hi~How can I help?". The real generated summary read
   * "客户需要更多信息，CTS询问如何提供帮助", misattributing NAL's own reply to
   * CTS. The literal root cause: the thread text handed to the model used to
   * label every outbound line "CTS" regardless of which client it was — this
   * asserts that label is now the real client's name.
   */
  it('labels the outbound side of the transcript with the real client name, never "CTS"', async () => {
    clientsById.set(NAL_CLIENT_ID, { name: 'New Asian Logistics', industry: 'logistics' })
    const messages: StoredMessage[] = [
      { direction: 'inbound', senderName: 'Customer', body: 'Need more information', sentAt: '2026-09-10T03:00:00Z' },
      { direction: 'outbound', senderName: null, body: 'Hi~How can I help?', sentAt: '2026-09-10T03:05:00Z' },
    ]
    modelReturns()

    await generateBrief(messages, NAL_CLIENT_ID)

    const call = mockResponsesCreate.mock.calls[0][0] as { input: { role: string; content: string }[] }
    const systemPrompt = call.input[0].content
    const userMessage = call.input[1].content

    expect(systemPrompt).toContain('New Asian Logistics')
    expect(systemPrompt).not.toContain('CTS')
    expect(userMessage).toContain('New Asian Logistics: Hi~How can I help?')
    expect(userMessage).not.toContain('CTS:')
  })

  it('never asks for or keeps trip details for a non-tourism client, even if the model fills them in', async () => {
    clientsById.set(NAL_CLIENT_ID, { name: 'New Asian Logistics', industry: 'logistics' })
    modelReturns({
      trip: {
        tour_interest: 'Best of China',
        travel_window: '2027年3月',
        party_size: 2,
        departure_city: 'Auckland',
        first_time_to_china: true,
        budget_signal: '$5000',
      },
    })

    const brief = await generateBrief(
      [{ direction: 'inbound', senderName: 'Customer', body: 'What are your rates to Sydney?', sentAt: '2026-09-10T03:00:00Z' }],
      NAL_CLIENT_ID,
    )

    expect(brief.trip).toEqual({
      tour_interest: null,
      travel_window: null,
      party_size: null,
      departure_city: null,
      first_time_to_china: null,
      budget_signal: null,
    })
  })

  /**
   * Regression case for CTS itself (client_id
   * c0000000-0000-0000-0000-000000000000) — proves the fix does not degrade
   * CTS's own cards. Real trip data from a real tourism enquiry must survive
   * unchanged, and the prompt must still name CTS and still ask for trip
   * fields.
   */
  it('keeps CTS working exactly as before: correct name, trip fields still captured', async () => {
    clientsById.set(CTS_CLIENT_ID, { name: 'CTS Tours NZ', industry: 'travel' })
    const trip = {
      tour_interest: 'Best of China',
      travel_window: '2027年3月',
      party_size: 2,
      departure_city: 'Auckland',
      first_time_to_china: true,
      budget_signal: null,
    }
    modelReturns({
      summary: '客户想了解 2027 年 3 月的中国团，2 人从奥克兰出发',
      intent_level: 'high',
      trip,
    })

    const brief = await generateBrief(
      [
        { direction: 'inbound', senderName: 'Sarah', body: 'Is the Great Wall included in Best of China?', sentAt: '2026-09-10T03:00:00Z' },
        { direction: 'outbound', senderName: null, body: 'Yes it is.', sentAt: '2026-09-10T03:05:00Z' },
      ],
      CTS_CLIENT_ID,
    )

    expect(brief.trip).toEqual(trip)
    expect(brief.intent_level).toBe('high')
    expect(brief.summary).not.toContain('New Asian Logistics')

    const call = mockResponsesCreate.mock.calls[0][0] as { input: { role: string; content: string }[] }
    expect(call.input[0].content).toContain('CTS Tours NZ')
    expect(call.input[1].content).toContain('CTS Tours NZ: Yes it is.')
  })

  it('falls back to a generic placeholder name when the client row cannot be found, never CTS', async () => {
    // clientsById is empty (beforeEach) — this id matches no row.
    modelReturns()

    await generateBrief(
      [{ direction: 'inbound', senderName: 'Customer', body: 'Hello?', sentAt: '2026-09-10T03:00:00Z' }],
      'deleted-client-id',
    )

    const call = mockResponsesCreate.mock.calls[0][0] as { input: { role: string; content: string }[] }
    expect(call.input[0].content).not.toContain('CTS')
  })

  /**
   * 魏征 review: the earlier fake returned one global row regardless of which
   * id was queried, so a "queried the wrong client_id" bug would have passed
   * silently. This proves the lookup is actually keyed by id — with both
   * clients loaded, asking for CTS_CLIENT_ID must never leak NAL's identity.
   */
  it('never leaks another client\'s name when two clients are loaded at once', async () => {
    clientsById.set(NAL_CLIENT_ID, { name: 'New Asian Logistics', industry: 'logistics' })
    clientsById.set(CTS_CLIENT_ID, { name: 'CTS Tours NZ', industry: 'travel' })
    modelReturns()

    await generateBrief(
      [{ direction: 'inbound', senderName: 'Customer', body: 'Hello?', sentAt: '2026-09-10T03:00:00Z' }],
      CTS_CLIENT_ID,
    )

    const call = mockResponsesCreate.mock.calls[0][0] as { input: { role: string; content: string }[] }
    expect(call.input[0].content).toContain('CTS Tours NZ')
    expect(call.input[0].content).not.toContain('New Asian Logistics')
  })

  /**
   * 魏征 review: `loadClientProfile` used to only destructure `{ data }` and
   * ignore `error` — a transient Supabase failure would silently produce a
   * generic-name, non-tourism profile instead of failing the card. That
   * would null out CTS's own trip fields on nothing more than a network
   * blip. It must throw, matching brief-cycle.ts's own "never silently
   * treat a read failure as an empty/default result" rule.
   */
  it('throws (does not silently fall back) when the client lookup itself fails', async () => {
    clientQueryError = 'connection reset by peer'
    modelReturns()

    await expect(
      generateBrief(
        [{ direction: 'inbound', senderName: 'Customer', body: 'Hello?', sentAt: '2026-09-10T03:00:00Z' }],
        CTS_CLIENT_ID,
      ),
    ).rejects.toThrow('connection reset by peer')
  })
})
