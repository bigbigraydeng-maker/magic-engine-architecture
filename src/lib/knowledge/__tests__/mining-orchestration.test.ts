/**
 * runKnowledgeMining orchestration tests — DB and LLM are mocked (following
 * the repo's established pattern, e.g. src/lib/crm/__tests__/qualified-buyer-autotag.test.ts
 * and src/lib/seo-agent/__tests__/conductor.test.ts). Pure-function behaviour
 * (template merging, redaction, provenance, specificity, conflicts) is
 * covered with real NAL data in mining.test.ts — this file only checks that
 * the orchestration wires those pieces together correctly and never writes
 * anything but candidates.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/anthropic/client', () => ({ callClaudeChat: vi.fn() }))

import { supabaseAdmin } from '@/lib/supabase'
import { callClaudeChat } from '@/lib/anthropic/client'
import { runKnowledgeMining, estimateWorstCaseExtractionCostUsd } from '../mining'

type Row = Record<string, unknown>

interface Fixture {
  conversations: Row[]
  messages: Row[]
  approvedFacts: Row[]
  miningRuns: Row[]
  writtenFacts: Row[]
}

let fixture: Fixture
let lastUpsertOnConflict: string | null = null
let mockCallClaudeChat: ReturnType<typeof vi.fn>

const CLIENT_A = '4ae76381-cd45-43bd-85cd-98cfd7604007'

function baseFixture(): Fixture {
  return { conversations: [{ id: 'conv-1', client_id: CLIENT_A }], messages: [], approvedFacts: [], miningRuns: [], writtenFacts: [] }
}

function outbound(body: string, sentAt: string, conversationId = 'conv-1') {
  return { conversation_id: conversationId, direction: 'outbound', body, sent_at: sentAt }
}
function inbound(body: string, sentAt: string, conversationId = 'conv-1') {
  return { conversation_id: conversationId, direction: 'inbound', body, sent_at: sentAt }
}

function applyFilters(rows: Row[], filters: Record<string, unknown>, inFilter: { key: string; values: unknown[] } | null, gtFilter: { key: string; value: unknown } | null) {
  let out = rows.filter((row) => Object.entries(filters).every(([k, v]) => row[k] === v))
  if (inFilter) out = out.filter((row) => inFilter.values.includes(row[inFilter.key]))
  if (gtFilter) out = out.filter((row) => String(row[gtFilter.key]) > String(gtFilter.value))
  return out
}

function fakeFrom(table: string): unknown {
  const builder: Record<string, unknown> = {}
  const filters: Record<string, unknown> = {}
  let inFilter: { key: string; values: unknown[] } | null = null
  let gtFilter: { key: string; value: unknown } | null = null
  let orderDesc = false
  let limit: number | null = null
  let range: [number, number] | null = null
  let insertPayload: Row | Row[] | null = null
  let updatePayload: Row | null = null
  let upsertPayload: Row[] | null = null

  Object.assign(builder, {
    select: () => builder,
    eq: (k: string, v: unknown) => {
      filters[k] = v
      return builder
    },
    in: (k: string, values: unknown[]) => {
      inFilter = { key: k, values }
      return builder
    },
    gt: (k: string, v: unknown) => {
      gtFilter = { key: k, value: v }
      return builder
    },
    order: (_col: string, opts?: { ascending?: boolean }) => {
      orderDesc = opts?.ascending === false
      return builder
    },
    limit: (n: number) => {
      limit = n
      return builder
    },
    range: (from: number, to: number) => {
      range = [from, to]
      return builder
    },
    single: () => builder,
    insert: (payload: Row | Row[]) => {
      insertPayload = payload
      return builder
    },
    update: (payload: Row) => {
      updatePayload = payload
      return builder
    },
    upsert: (payload: Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
      upsertPayload = payload
      lastUpsertOnConflict = options?.onConflict ?? null
      return builder
    },
    then: (resolve: (v: { data: unknown; error: { message: string } | null }) => unknown) => {
      if (insertPayload) {
        if (table === 'client_knowledge_mining_runs') {
          const row = { id: `run-${fixture.miningRuns.length + 1}`, ...(insertPayload as Row) }
          fixture.miningRuns.push(row)
          return resolve({ data: row, error: null })
        }
        return resolve({ data: null, error: { message: `unexpected insert on ${table}` } })
      }
      if (updatePayload) {
        if (table === 'client_knowledge_mining_runs') {
          const id = filters.id
          const run = fixture.miningRuns.find((r) => r.id === id)
          if (run) Object.assign(run, updatePayload)
          return resolve({ data: null, error: null })
        }
        if (table === 'client_knowledge_facts') {
          const id = filters.id
          const row = [...fixture.approvedFacts, ...fixture.writtenFacts].find((f) => f.id === id)
          if (row) Object.assign(row, updatePayload)
          return resolve({ data: null, error: null })
        }
        return resolve({ data: null, error: { message: `unexpected update on ${table}` } })
      }
      if (upsertPayload) {
        if (table === 'client_knowledge_facts') {
          const inserted: Row[] = []
          for (const row of upsertPayload) {
            // Models the REAL unique index: (client_id, fact_key, scope,
            // value_fingerprint), unconditional on status (see migration
            // 20260913120000). A NULL value_fingerprint (e.g. a manually
            // created approved fact that never set one) never conflicts
            // with anything — same as real Postgres NULL semantics in a
            // unique index — which is exactly why an approved fact lacking
            // a fingerprint can never silently block a new candidate.
            const dup = [...fixture.approvedFacts, ...fixture.writtenFacts].find(
              (f) =>
                f.client_id === row.client_id &&
                f.fact_key === row.fact_key &&
                JSON.stringify(f.scope) === JSON.stringify(row.scope) &&
                f.value_fingerprint != null &&
                f.value_fingerprint === row.value_fingerprint,
            )
            if (dup) continue
            const withId = { id: `fact-${fixture.writtenFacts.length + 1}`, ...row }
            fixture.writtenFacts.push(withId)
            inserted.push({ id: withId.id })
          }
          return resolve({ data: inserted, error: null })
        }
        return resolve({ data: null, error: { message: `unexpected upsert on ${table}` } })
      }

      if (table === 'conversations') {
        const rows = applyFilters(fixture.conversations, filters, inFilter, gtFilter)
        const sliced = range ? rows.slice(range[0], range[1] + 1) : rows
        return resolve({ data: sliced, error: null })
      }
      if (table === 'conversation_messages') {
        let rows = applyFilters(fixture.messages, {}, inFilter, gtFilter)
        rows = [...rows].sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)))
        const sliced = range ? rows.slice(range[0], range[1] + 1) : rows
        return resolve({ data: sliced, error: null })
      }
      if (table === 'client_knowledge_mining_runs') {
        let rows = applyFilters(fixture.miningRuns, filters, inFilter, gtFilter)
        rows = [...rows].sort((a, b) => (orderDesc ? -1 : 1) * String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
        const sliced = limit ? rows.slice(0, limit) : rows
        return resolve({ data: sliced, error: null })
      }
      if (table === 'client_knowledge_facts') {
        // Combine both fixture arrays — a real table holds every status in
        // one place. Lets a test simulate "a prior run already wrote an
        // unreviewed candidate" by seeding fixture.writtenFacts directly.
        const rows = applyFilters([...fixture.approvedFacts, ...fixture.writtenFacts], filters, inFilter, gtFilter)
        return resolve({ data: rows, error: null })
      }
      if (table === 'client_knowledge_rollout_events') {
        return resolve({ data: [], error: null })
      }
      return resolve({ data: [], error: null })
    },
  })

  return builder
}

function extractionResponse(isDealSpecific: boolean, facts: Row[] = [], costUsd = 0.001) {
  return { text: JSON.stringify({ is_deal_specific: isDealSpecific, facts }), cost_usd: costUsd, input_tokens: 100, output_tokens: 50 }
}

const REAL_MAIN_TEMPLATE =
  'Shipping rates\n' +
  '• Under 20 kg: NZD 4/kg\n' +
  '• 20 kg or more: NZD 2/kg\n' +
  'Service fees per shipment\n' +
  '• General goods: NZD 12\n' +
  '• Food products: NZD 24\n' +
  'Please note that food and general goods must be packed, shipped and charged separately.'

const BUDGET = { maxMessages: 1000, maxModelCalls: 10, maxSpendUsd: 1 }

beforeEach(() => {
  fixture = baseFixture()
  lastUpsertOnConflict = null
  vi.mocked(supabaseAdmin.from).mockImplementation(fakeFrom as never)
  mockCallClaudeChat = vi.mocked(callClaudeChat)
  mockCallClaudeChat.mockReset()
})

describe('runKnowledgeMining — happy path', () => {
  it('writes a candidate for a repeated, model-approved, number-verified template', async () => {
    // Two DIFFERENT conversations (distinctConversationCount=2) — a template
    // sent twice to the same customer in one thread would now correctly be
    // deal_specific (see mining.test.ts's distinctConversationCount tests).
    fixture.conversations.push({ id: 'c2', client_id: CLIENT_A })
    fixture.messages.push(
      inbound('what is the rate for parcels under 20kg?', '2026-01-01T00:00:00Z', 'conv-1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z', 'conv-1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:01:00Z', 'c2'),
    )
    mockCallClaudeChat.mockResolvedValueOnce(
      extractionResponse(false, [
        {
          fact_key: 'rate.parcel.per_kg',
          scope: { service_line: 'parcel_sea' },
          statement: 'Under 20 kg: NZD 4/kg',
          structured_value: { unit: 'NZD/kg', under_kg: 20, rate: 4 },
        },
      ]),
    )

    const receipt = await runKnowledgeMining(CLIENT_A, BUDGET)

    expect(receipt.status).toBe('succeeded')
    expect(receipt.candidatesWritten).toBe(1)
    expect(fixture.writtenFacts).toHaveLength(1)
    expect(fixture.writtenFacts[0]).toMatchObject({ status: 'candidate', client_id: CLIENT_A })
    expect(fixture.writtenFacts[0].valid_until).toBeTruthy()
  })

  it('never writes anything but status="candidate"', async () => {
    fixture.messages.push(outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z'), outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:01:00Z'))
    mockCallClaudeChat.mockResolvedValueOnce(
      extractionResponse(false, [
        { fact_key: 'rate.x', scope: {}, statement: 'Under 20 kg: NZD 4/kg', structured_value: { unit: 'NZD/kg', rate: 4 } },
      ]),
    )
    await runKnowledgeMining(CLIENT_A, BUDGET)
    expect(fixture.writtenFacts.every((f) => f.status === 'candidate')).toBe(true)
  })
})

describe('runKnowledgeMining — safety filters actually drop candidates', () => {
  it('drops a candidate the model marks deal-specific, isolated from the occurrence-count guard', async () => {
    // Occurs twice (so the separate "count<=1" guard can't be what causes the
    // drop) — the model's own is_deal_specific:true flag must be sufficient
    // on its own to reject a candidate, even though it still populated
    // "facts" (a model that doesn't perfectly follow "empty facts when
    // deal-specific" is exactly the case classifyCandidateSpecificity exists
    // to catch).
    fixture.messages.push(
      outbound('Freight: 138 kg × NZD 4 = NZD 552', '2026-01-01T00:01:00Z'),
      outbound('Freight: 138 kg × NZD 4 = NZD 552', '2026-01-02T00:01:00Z'),
    )
    mockCallClaudeChat.mockResolvedValueOnce(
      extractionResponse(true, [
        { fact_key: 'rate.x', scope: {}, statement: 'NZD 4 per kg', structured_value: { unit: 'NZD/kg', rate: 4 } },
      ]),
    )
    const receipt = await runKnowledgeMining(CLIENT_A, BUDGET)
    expect(receipt.candidatesWritten).toBe(0)
    expect(receipt.dealSpecificSkipped).toBe(1)
  })

  it('drops a candidate that only occurred once, even if the model approves it', async () => {
    fixture.messages.push(outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z')) // occurs once
    mockCallClaudeChat.mockResolvedValueOnce(
      extractionResponse(false, [
        { fact_key: 'rate.x', scope: {}, statement: 'Under 20 kg: NZD 4/kg', structured_value: { unit: 'NZD/kg', rate: 4 } },
      ]),
    )
    const receipt = await runKnowledgeMining(CLIENT_A, BUDGET)
    expect(receipt.candidatesWritten).toBe(0)
    expect(receipt.dealSpecificSkipped).toBe(1)
  })

  // 魏征 review (2026-09-13): proves the wiring uses distinctConversationCount,
  // not raw send count — 3 sends, all to the SAME conversation, must still
  // be treated as "occurred once" (one customer, repeatedly told the same
  // thing), even though `count` itself is 3.
  it('drops a candidate sent 3 times but all to the SAME conversation (distinctConversationCount=1)', async () => {
    fixture.messages.push(
      outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z', 'conv-1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:01:00Z', 'conv-1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-03T00:01:00Z', 'conv-1'),
    )
    mockCallClaudeChat.mockResolvedValueOnce(
      extractionResponse(false, [
        { fact_key: 'rate.x', scope: {}, statement: 'Under 20 kg: NZD 4/kg', structured_value: { unit: 'NZD/kg', rate: 4 } },
      ]),
    )
    const receipt = await runKnowledgeMining(CLIENT_A, BUDGET)
    expect(receipt.candidatesWritten).toBe(0)
    expect(receipt.dealSpecificSkipped).toBe(1)
  })

  // Mutation guard §9.14-D anti-hallucination: a fabricated number must never reach the table.
  it('drops a candidate whose number the source message never contained (hallucination)', async () => {
    fixture.conversations.push({ id: 'c2', client_id: CLIENT_A })
    fixture.messages.push(
      outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z', 'conv-1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:01:00Z', 'c2'),
    )
    mockCallClaudeChat.mockResolvedValueOnce(
      extractionResponse(false, [
        // NZD 9/kg never appears anywhere in REAL_MAIN_TEMPLATE
        { fact_key: 'rate.x', scope: {}, statement: 'Under 20 kg: NZD 9/kg', structured_value: { unit: 'NZD/kg', rate: 9 } },
      ]),
    )
    const receipt = await runKnowledgeMining(CLIENT_A, BUDGET)
    expect(receipt.candidatesWritten).toBe(0)
    expect(receipt.provenanceRejected).toBe(1)
  })
})

describe('runKnowledgeMining — budget enforcement', () => {
  it('never calls the model more than maxModelCalls times', async () => {
    fixture.conversations.push({ id: 'c2', client_id: CLIENT_A })
    fixture.messages.push(
      outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z', 'conv-1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:01:00Z', 'conv-1'),
      outbound('Some other repeated template', '2026-01-03T00:01:00Z', 'c2'),
      outbound('Some other repeated template', '2026-01-04T00:01:00Z', 'c2'),
    )
    mockCallClaudeChat.mockResolvedValue(extractionResponse(true, []))
    const receipt = await runKnowledgeMining(CLIENT_A, { maxMessages: 1000, maxModelCalls: 1, maxSpendUsd: 1 })
    expect(receipt.modelCallsUsed).toBe(1)
    expect(mockCallClaudeChat).toHaveBeenCalledTimes(1)
  })

  it('stops once the pre-call worst-case estimate for the NEXT call would exceed maxSpendUsd', async () => {
    // Per §9.14-B the cap is checked with a worst-case estimate BEFORE each
    // call, not against what a call actually cost afterwards — so the
    // budget here is sized off the real estimator: enough for one call's
    // worst case, not enough for two.
    const oneCallEstimate = estimateWorstCaseExtractionCostUsd(`${REAL_MAIN_TEMPLATE} `)
    fixture.conversations.push({ id: 'c2', client_id: CLIENT_A })
    fixture.messages.push(
      outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z', 'conv-1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:01:00Z', 'conv-1'),
      outbound('Some other repeated template', '2026-01-03T00:01:00Z', 'c2'),
      outbound('Some other repeated template', '2026-01-04T00:01:00Z', 'c2'),
    )
    // Actual cost returned by the (mocked) call matches its own estimate —
    // realistic, unlike an arbitrary spend that would just test the old,
    // rejected "check after the fact" design.
    mockCallClaudeChat.mockResolvedValue(extractionResponse(true, [], oneCallEstimate))
    const receipt = await runKnowledgeMining(CLIENT_A, {
      maxMessages: 1000,
      maxModelCalls: 10,
      maxSpendUsd: oneCallEstimate * 1.5,
    })
    expect(mockCallClaudeChat).toHaveBeenCalledTimes(1)
    expect(receipt.modelCallsUsed).toBe(1)
    expect(receipt.costUsd).toBeCloseTo(oneCallEstimate)
  })

  it('refuses to run at all with an incomplete budget', async () => {
    // @ts-expect-error deliberately missing maxSpendUsd
    await expect(runKnowledgeMining(CLIENT_A, { maxMessages: 500, maxModelCalls: 10 })).rejects.toThrow()
    expect(mockCallClaudeChat).not.toHaveBeenCalled()
  })
})

describe('runKnowledgeMining — incremental watermark', () => {
  it('only scans messages after the previous succeeded run’s high_watermark_at', async () => {
    fixture.miningRuns.push({
      id: 'prior-run',
      client_id: CLIENT_A,
      status: 'succeeded',
      high_watermark_at: '2026-01-01T12:00:00Z',
      created_at: '2026-01-01T12:00:01Z',
    })
    fixture.messages.push(
      outbound('old message before watermark', '2026-01-01T00:00:00Z'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:01:00Z'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-03T00:01:00Z'),
    )
    mockCallClaudeChat.mockResolvedValueOnce(
      extractionResponse(false, [
        { fact_key: 'rate.x', scope: {}, statement: 'Under 20 kg: NZD 4/kg', structured_value: { unit: 'NZD/kg', rate: 4 } },
      ]),
    )
    const receipt = await runKnowledgeMining(CLIENT_A, BUDGET)
    expect(receipt.messagesScanned).toBe(2) // old message excluded
  })
})

describe('runKnowledgeMining — conflict grouping against approved facts', () => {
  it('flags a new candidate that contradicts an already-approved fact of the same unit', async () => {
    fixture.approvedFacts.push({
      id: 'approved-1',
      client_id: CLIENT_A,
      fact_key: 'rate.parcel.per_kg',
      scope: {},
      statement: 'Under 20 kg: NZD 4/kg',
      structured_value: { unit: 'NZD/kg', rate: 4 },
      status: 'approved',
      visibility: 'internal_only',
      sensitivity: 'general',
      valid_from: '2026-01-01T00:00:00Z',
      valid_until: null,
      approved_by_email: null,
      approved_at: null,
      client_confirmed_by_email: null,
      client_confirmed_at: null,
      client_confirmation_fingerprint: null,
    })
    fixture.conversations.push({ id: 'c2', client_id: CLIENT_A })
    fixture.messages.push(
      outbound('Under 20 kg: NZD 9/kg', '2026-01-01T00:01:00Z', 'conv-1'),
      outbound('Under 20 kg: NZD 9/kg', '2026-01-02T00:01:00Z', 'c2'),
    )
    mockCallClaudeChat.mockResolvedValueOnce(
      extractionResponse(false, [
        { fact_key: 'rate.parcel.per_kg', scope: {}, statement: 'Under 20 kg: NZD 9/kg', structured_value: { unit: 'NZD/kg', rate: 9 } },
      ]),
    )
    const receipt = await runKnowledgeMining(CLIENT_A, BUDGET)
    expect(receipt.candidatesWritten).toBe(1)
    expect(receipt.conflictGroups).toBe(1)
    expect(fixture.writtenFacts[0].conflict_group_id).toBeTruthy()
  })

  // 子牙 + 魏征 review (2026-09-13), blocker B1: a candidate proposing a
  // DIFFERENT value than an already-approved fact at the same identity must
  // never be silently dropped by the write-time conflict target. This is
  // the exact scenario the old (client_id,fact_key,scope)-only ON CONFLICT
  // target would eat — asserted explicitly here, not just via candidatesWritten.
  it('never silently drops a candidate that conflicts with an approved fact of the identical (fact_key, scope)', async () => {
    fixture.approvedFacts.push({
      id: 'approved-1',
      client_id: CLIENT_A,
      fact_key: 'rate.parcel.per_kg',
      scope: {},
      statement: 'Under 20 kg: NZD 4/kg',
      structured_value: { unit: 'NZD/kg', rate: 4 },
      status: 'approved',
      visibility: 'internal_only',
      sensitivity: 'general',
      valid_from: '2026-01-01T00:00:00Z',
      valid_until: null,
      approved_by_email: null,
      approved_at: null,
      client_confirmed_by_email: null,
      client_confirmed_at: null,
      client_confirmation_fingerprint: null,
    })
    fixture.conversations.push({ id: 'c2', client_id: CLIENT_A })
    fixture.messages.push(
      outbound('Under 20 kg: NZD 9/kg', '2026-01-01T00:01:00Z', 'conv-1'),
      outbound('Under 20 kg: NZD 9/kg', '2026-01-02T00:01:00Z', 'c2'),
    )
    mockCallClaudeChat.mockResolvedValueOnce(
      extractionResponse(false, [
        { fact_key: 'rate.parcel.per_kg', scope: {}, statement: 'Under 20 kg: NZD 9/kg', structured_value: { unit: 'NZD/kg', rate: 9 } },
      ]),
    )
    const receipt = await runKnowledgeMining(CLIENT_A, BUDGET)
    expect(receipt.candidatesWritten).toBe(1)
    expect(fixture.writtenFacts).toHaveLength(1)
    // The approved row is untouched, AND the new, differing candidate exists
    // as its own row — neither silently overwrote nor silently dropped the
    // other.
    expect(fixture.approvedFacts[0].statement).toBe('Under 20 kg: NZD 4/kg')
    expect(fixture.writtenFacts[0].statement).toBe('Under 20 kg: NZD 9/kg')
    // The in-memory mock's own dedup logic doesn't consult this option (it
    // always keys on value_fingerprint, mirroring the real unique index) —
    // so it can't by itself catch a regression back to the old,
    // approved-blocking conflict target. Assert the literal string mining.ts
    // actually sends, so THAT regression is still caught here directly.
    expect(lastUpsertOnConflict).toBe('client_id,fact_key,scope,value_fingerprint')
  })

  // 魏征 review (2026-09-13), blocker B2: a conflict spanning a PRIOR run's
  // still-unreviewed candidate and a fresh one from this run must land under
  // the SAME conflict_group_id, not fragment into two disconnected groups.
  it('links a new conflicting candidate to a conflict group from a prior, unreviewed mining run', async () => {
    fixture.writtenFacts.push({
      id: 'prior-candidate-1',
      client_id: CLIENT_A,
      fact_key: 'rate.parcel.per_kg',
      scope: {},
      statement: 'Under 20 kg: NZD 7/kg',
      structured_value: { unit: 'NZD/kg', rate: 7 },
      status: 'candidate',
      visibility: 'internal_only',
      sensitivity: 'price',
      valid_until: '2099-01-01T00:00:00Z',
      source_kind: 'conversation_mining',
      evidence: {},
      conflict_group_id: null, // was solo, no conflict seen yet as of the prior run
      value_fingerprint: 'prior-fp',
    })
    fixture.conversations.push({ id: 'c2', client_id: CLIENT_A })
    fixture.messages.push(
      outbound('Under 20 kg: NZD 6/kg', '2026-01-01T00:01:00Z', 'conv-1'),
      outbound('Under 20 kg: NZD 6/kg', '2026-01-02T00:01:00Z', 'c2'),
    )
    mockCallClaudeChat.mockResolvedValueOnce(
      extractionResponse(false, [
        { fact_key: 'rate.parcel.per_kg', scope: {}, statement: 'Under 20 kg: NZD 6/kg', structured_value: { unit: 'NZD/kg', rate: 6 } },
      ]),
    )
    const receipt = await runKnowledgeMining(CLIENT_A, BUDGET)
    expect(receipt.candidatesWritten).toBe(1)
    const priorRow = fixture.writtenFacts.find((f) => f.id === 'prior-candidate-1')
    const newRow = fixture.writtenFacts.find((f) => f.id !== 'prior-candidate-1')
    expect(priorRow?.conflict_group_id).toBeTruthy() // backfilled — it was null before this run
    expect(newRow?.conflict_group_id).toBe(priorRow?.conflict_group_id) // same group, not a fresh disconnected one
  })

  it('reuses an EXISTING conflict group id rather than minting a new one when the prior candidate already had one', async () => {
    fixture.writtenFacts.push({
      id: 'prior-candidate-2',
      client_id: CLIENT_A,
      fact_key: 'rate.parcel.per_kg',
      scope: {},
      statement: 'Under 20 kg: NZD 7/kg',
      structured_value: { unit: 'NZD/kg', rate: 7 },
      status: 'candidate',
      visibility: 'internal_only',
      sensitivity: 'price',
      valid_until: '2099-01-01T00:00:00Z',
      source_kind: 'conversation_mining',
      evidence: {},
      conflict_group_id: 'existing-group-xyz',
      value_fingerprint: 'prior-fp',
    })
    fixture.conversations.push({ id: 'c2', client_id: CLIENT_A })
    fixture.messages.push(
      outbound('Under 20 kg: NZD 6/kg', '2026-01-01T00:01:00Z', 'conv-1'),
      outbound('Under 20 kg: NZD 6/kg', '2026-01-02T00:01:00Z', 'c2'),
    )
    mockCallClaudeChat.mockResolvedValueOnce(
      extractionResponse(false, [
        { fact_key: 'rate.parcel.per_kg', scope: {}, statement: 'Under 20 kg: NZD 6/kg', structured_value: { unit: 'NZD/kg', rate: 6 } },
      ]),
    )
    await runKnowledgeMining(CLIENT_A, BUDGET)
    const newRow = fixture.writtenFacts.find((f) => f.id !== 'prior-candidate-2')
    expect(newRow?.conflict_group_id).toBe('existing-group-xyz')
  })
})

describe('runKnowledgeMining — failure handling', () => {
  it('records a failed run and does not throw when the model call rejects', async () => {
    fixture.messages.push(outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z'), outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:01:00Z'))
    mockCallClaudeChat.mockRejectedValueOnce(new Error('anthropic 503'))
    const receipt = await runKnowledgeMining(CLIENT_A, BUDGET)
    expect(receipt.status).toBe('failed')
    expect(receipt.error).toContain('anthropic 503')
    const runRow = fixture.miningRuns.find((r) => r.id === receipt.runId)
    expect(runRow?.status).toBe('failed')
  })
})
