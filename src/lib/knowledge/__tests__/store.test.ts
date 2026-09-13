/**
 * getClientKnowledge / isKnowledgeRolloutEnabled — the read entry point every
 * AI-facing consumer must migrate to (design §3.4/§9.14). Mutation guards
 * below map 1:1 to §9.14-D's variance-test checklist items 3, 4, 5.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { getClientKnowledge, isKnowledgeRolloutEnabled } from '../store'
import { computeFactFingerprint } from '../fingerprint'

type Row = Record<string, unknown>

interface Fixture {
  facts: Row[]
  rolloutEvents: Row[]
  factsReadShouldFail: boolean
  rolloutReadShouldFail: boolean
}

let fixture: Fixture

function baseFixture(): Fixture {
  return { facts: [], rolloutEvents: [], factsReadShouldFail: false, rolloutReadShouldFail: false }
}

const CLIENT_A = '4ae76381-cd45-43bd-85cd-98cfd7604007'
const CLIENT_B = 'c0000000-0000-0000-0000-000000000000'

function priceFact(overrides: Partial<Row> = {}): Row {
  const base = {
    id: 'fact-1',
    client_id: CLIENT_A,
    fact_key: 'rate.parcel.per_kg',
    scope: { service_line: 'parcel_sea' },
    statement: 'Under 20 kg: NZD 4/kg',
    structured_value: { under_kg: 20, rate: 4 },
    status: 'approved',
    visibility: 'customer_ok',
    sensitivity: 'price',
    valid_from: '2026-01-01T00:00:00Z',
    valid_until: '2099-01-01T00:00:00Z',
    approved_by_email: 'fde@magicengine.com.au',
    approved_at: '2026-09-01T00:00:00Z',
    client_confirmed_by_email: null,
    client_confirmed_at: null,
    client_confirmation_fingerprint: null,
  }
  const merged: Row = { ...base, ...overrides }
  // Keep the fingerprint honest for the common case of "confirmed" fixtures:
  // if the caller supplied confirmation fields but no explicit fingerprint,
  // compute one that matches the (possibly overridden) content.
  if (merged.client_confirmed_at && !overrides.client_confirmation_fingerprint) {
    merged.client_confirmation_fingerprint = computeFactFingerprint({
      statement: merged.statement as string,
      structuredValue: merged.structured_value,
      scope: merged.scope,
      validUntil: merged.valid_until as string | null,
      visibility: merged.visibility as string,
      sensitivity: merged.sensitivity as string,
    })
  }
  return merged
}

/** Only implements the chained calls store.ts actually issues. */
function fakeFrom(table: string): unknown {
  const builder: Record<string, unknown> = {}
  const filters: Record<string, unknown> = {}
  let inFilter: { key: string; values: unknown[] } | null = null

  Object.assign(builder, {
    select: () => builder,
    eq: (key: string, value: unknown) => {
      filters[key] = value
      return builder
    },
    in: (key: string, values: unknown[]) => {
      inFilter = { key, values }
      return builder
    },
    order: () => builder,
    limit: () => builder,
    then: (resolve: (v: { data: Row[] | null; error: { message: string } | null }) => unknown) => {
      if (table === 'client_knowledge_facts') {
        if (fixture.factsReadShouldFail) {
          return resolve({ data: null, error: { message: 'connection reset' } })
        }
        const rows = fixture.facts.filter((row) =>
          Object.entries(filters).every(([k, v]) => row[k] === v),
        )
        return resolve({ data: rows, error: null })
      }
      if (table === 'client_knowledge_rollout_events') {
        if (fixture.rolloutReadShouldFail) {
          return resolve({ data: null, error: { message: 'connection reset' } })
        }
        let rows = fixture.rolloutEvents.filter((row) =>
          Object.entries(filters).every(([k, v]) => row[k] === v),
        )
        if (inFilter) {
          const { key, values } = inFilter
          rows = rows.filter((row) => values.includes(row[key]))
        }
        // newest-first, matching the real .order('created_at', {ascending:false})
        rows = [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        return resolve({ data: rows, error: null })
      }
      return resolve({ data: [], error: null })
    },
  })

  return builder
}

beforeEach(() => {
  fixture = baseFixture()
  vi.mocked(supabaseAdmin.from).mockImplementation(fakeFrom as never)
})

function enableRollout(clientId: string) {
  fixture.rolloutEvents.push({
    client_id: clientId,
    event_type: 'enabled',
    created_at: '2026-09-13T00:00:00Z',
  })
}

describe('getClientKnowledge — customer_reply', () => {
  it('returns a general fact once the rollout switch is on, with no confirmation needed', async () => {
    enableRollout(CLIENT_A)
    fixture.facts.push(priceFact({ sensitivity: 'general', client_confirmed_at: null }))

    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' })
    expect(result).toHaveLength(1)
    expect(result[0].sensitivity).toBe('general')
  })

  it('excludes everything when the rollout switch has never been turned on', async () => {
    fixture.facts.push(priceFact({ sensitivity: 'general' }))
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' })
    expect(result).toEqual([])
  })

  it('excludes a price fact with no client confirmation, even when approved and enabled', async () => {
    enableRollout(CLIENT_A)
    fixture.facts.push(priceFact()) // sensitivity: price, no confirmation
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' })
    expect(result).toEqual([])
  })

  it('returns a price fact once confirmed with a matching fingerprint', async () => {
    enableRollout(CLIENT_A)
    fixture.facts.push(
      priceFact({ client_confirmed_by_email: 'boss@nal.co.nz', client_confirmed_at: '2026-09-10T00:00:00Z' }),
    )
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' })
    expect(result).toHaveLength(1)
  })

  // Mutation guard §9.14-D #3: any edit after confirmation must invalidate it.
  it('excludes a confirmed price fact whose content changed after confirmation (stale fingerprint)', async () => {
    enableRollout(CLIENT_A)
    const confirmed = priceFact({
      client_confirmed_by_email: 'boss@nal.co.nz',
      client_confirmed_at: '2026-09-10T00:00:00Z',
    })
    // Edit the statement AFTER the fingerprint above was computed from the
    // original content — simulates "FDE changed the price post-confirmation".
    confirmed.statement = 'Under 20 kg: NZD 9/kg'
    fixture.facts.push(confirmed)
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' })
    expect(result).toEqual([])
  })

  // Mutation guard §9.14-D #4: expiry must be enforced.
  it('excludes an expired fact', async () => {
    enableRollout(CLIENT_A)
    fixture.facts.push(priceFact({ sensitivity: 'general', valid_until: '2020-01-01T00:00:00Z' }))
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' })
    expect(result).toEqual([])
  })

  it('excludes a fact that has not started yet (valid_from in the future)', async () => {
    enableRollout(CLIENT_A)
    fixture.facts.push(priceFact({ sensitivity: 'general', valid_from: '2099-01-01T00:00:00Z' }))
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' })
    expect(result).toEqual([])
  })

  it('excludes an internal_only fact', async () => {
    enableRollout(CLIENT_A)
    fixture.facts.push(priceFact({ sensitivity: 'general', visibility: 'internal_only' }))
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' })
    expect(result).toEqual([])
  })

  it('excludes a forbidden fact even if it were somehow confirmed', async () => {
    enableRollout(CLIENT_A)
    fixture.facts.push(
      priceFact({
        sensitivity: 'general',
        visibility: 'forbidden',
        client_confirmed_by_email: 'boss@nal.co.nz',
        client_confirmed_at: '2026-09-10T00:00:00Z',
      }),
    )
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' })
    expect(result).toEqual([])
  })

  it('never returns another client’s facts (cross-client isolation)', async () => {
    enableRollout(CLIENT_A)
    enableRollout(CLIENT_B)
    fixture.facts.push(priceFact({ id: 'a1', client_id: CLIENT_A, sensitivity: 'general' }))
    fixture.facts.push(priceFact({ id: 'b1', client_id: CLIENT_B, sensitivity: 'general' }))
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' })
    expect(result.map((f) => f.id)).toEqual(['a1'])
  })

  it('filters by scope when given', async () => {
    enableRollout(CLIENT_A)
    fixture.facts.push(
      priceFact({ id: 'sea', sensitivity: 'general', scope: { service_line: 'parcel_sea' } }),
      priceFact({ id: 'air', sensitivity: 'general', scope: { service_line: 'parcel_air' } }),
    )
    const result = await getClientKnowledge(CLIENT_A, {
      purpose: 'customer_reply',
      scope: { service_line: 'parcel_air' },
    })
    expect(result.map((f) => f.id)).toEqual(['air'])
  })
})

describe('getClientKnowledge — internal_brief / lead_classification', () => {
  it('does NOT require the rollout switch or a client confirmation', async () => {
    // rollout switch never turned on
    fixture.facts.push(priceFact()) // price, unconfirmed
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'internal_brief' })
    expect(result).toHaveLength(1)
  })

  it('still excludes a forbidden fact', async () => {
    fixture.facts.push(priceFact({ visibility: 'forbidden' }))
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'internal_brief' })
    expect(result).toEqual([])
  })

  it('still excludes an expired fact', async () => {
    fixture.facts.push(priceFact({ valid_until: '2020-01-01T00:00:00Z' }))
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'lead_classification' })
    expect(result).toEqual([])
  })
})

describe('getClientKnowledge — read failure', () => {
  it('throws rather than returning an empty array when the facts read fails', async () => {
    enableRollout(CLIENT_A)
    fixture.factsReadShouldFail = true
    await expect(getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' })).rejects.toThrow(/read failed/)
  })

  it('throws for internal_brief reads too (no purpose is exempt from surfacing a real failure)', async () => {
    fixture.factsReadShouldFail = true
    await expect(getClientKnowledge(CLIENT_A, { purpose: 'internal_brief' })).rejects.toThrow(/read failed/)
  })
})

describe('isKnowledgeRolloutEnabled', () => {
  it('is false when no event has ever been recorded', async () => {
    expect(await isKnowledgeRolloutEnabled(CLIENT_A)).toBe(false)
  })

  it('is true right after an "enabled" event', async () => {
    enableRollout(CLIENT_A)
    expect(await isKnowledgeRolloutEnabled(CLIENT_A)).toBe(true)
  })

  it('reflects only the latest event — enabled then disabled means off', async () => {
    fixture.rolloutEvents.push(
      { client_id: CLIENT_A, event_type: 'enabled', created_at: '2026-09-01T00:00:00Z' },
      { client_id: CLIENT_A, event_type: 'disabled', created_at: '2026-09-02T00:00:00Z' },
    )
    expect(await isKnowledgeRolloutEnabled(CLIENT_A)).toBe(false)
  })

  it('reflects only the latest event — disabled then enabled means on', async () => {
    fixture.rolloutEvents.push(
      { client_id: CLIENT_A, event_type: 'disabled', created_at: '2026-09-01T00:00:00Z' },
      { client_id: CLIENT_A, event_type: 'enabled', created_at: '2026-09-02T00:00:00Z' },
    )
    expect(await isKnowledgeRolloutEnabled(CLIENT_A)).toBe(true)
  })

  // Mutation guard §9.14-D #5: a read failure on the switch itself must never
  // be interpreted as "on".
  it('is false when the read itself fails (fail-closed, never fail-open)', async () => {
    enableRollout(CLIENT_A) // would be "on" if read successfully
    fixture.rolloutReadShouldFail = true
    expect(await isKnowledgeRolloutEnabled(CLIENT_A)).toBe(false)
  })
})
