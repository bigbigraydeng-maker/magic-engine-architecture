import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

import { setGa4Property } from '../property'

function chainResolvingMaybeSingle(data: unknown) {
  const chain: Record<string, unknown> = {}
  ;['select', 'eq', 'limit'].forEach((m) => { chain[m] = vi.fn().mockReturnValue(chain) })
  chain.maybeSingle = vi.fn().mockResolvedValue({ data })
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('setGa4Property', () => {
  it('rejects a malformed property string before touching the DB', async () => {
    const result = await setGa4Property('client-1', 'not-a-property-id')

    expect(result).toEqual({ ok: false, reason: 'invalid' })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('returns not_connected when the client has no active google_ga4 row', async () => {
    mocks.from.mockReturnValue(chainResolvingMaybeSingle(null))

    const result = await setGa4Property('client-1', 'properties/123')

    expect(result).toEqual({ ok: false, reason: 'not_connected' })
  })

  it('updates account_id on the existing active connection when found', async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null })
    const update    = vi.fn().mockReturnValue({ eq: updateEq })
    let callCount = 0
    mocks.from.mockImplementation(() => {
      callCount += 1
      if (callCount === 1) return chainResolvingMaybeSingle({ id: 'conn-1' })
      return { update }
    })

    const result = await setGa4Property('client-1', 'properties/456')

    expect(result).toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ account_id: 'properties/456' }),
    )
    expect(updateEq).toHaveBeenCalledWith('id', 'conn-1')
  })

  it('does NOT apply the cross-client exclusivity check GBP uses — no lookup of other clients\' rows', async () => {
    // Only two .from() calls expected total: the read + the update. A cross-client
    // exclusivity check (like setGbpLocation's) would add a third .from() call.
    const updateEq = vi.fn().mockResolvedValue({ error: null })
    const update    = vi.fn().mockReturnValue({ eq: updateEq })
    let callCount = 0
    mocks.from.mockImplementation(() => {
      callCount += 1
      if (callCount === 1) return chainResolvingMaybeSingle({ id: 'conn-1' })
      return { update }
    })

    await setGa4Property('client-1', 'properties/456')

    expect(mocks.from).toHaveBeenCalledTimes(2)
  })
})
