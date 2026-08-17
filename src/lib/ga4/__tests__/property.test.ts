import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  verifyGa4PropertyAccess: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

vi.mock('../client', () => ({
  verifyGa4PropertyAccess: mocks.verifyGa4PropertyAccess,
}))

import { setGa4Property } from '../property'

function record(table: string, method: string, args: unknown[]) {
  mocks.calls.push({ table, method, args })
}

function connectorsTable() {
  return {
    upsert: vi.fn((...args: unknown[]) => {
      record('client_connectors', 'upsert', args)
      return Promise.resolve({ error: null })
    }),
  }
}

function mockTables() {
  mocks.from.mockImplementation((table: string) => {
    if (table === 'client_connectors') return connectorsTable()
    throw new Error(`unexpected table in test: ${table}`)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.calls.length = 0
  mockTables()
})

describe('setGa4Property', () => {
  it('rejects a malformed property string before touching the DB or calling Google', async () => {
    const result = await setGa4Property('client-1', 'not-a-property-id')

    expect(result).toEqual({ ok: false, reason: 'invalid' })
    expect(mocks.verifyGa4PropertyAccess).not.toHaveBeenCalled()
    expect(mocks.calls.length).toBe(0)
  })

  it('accepts a bare numeric property id — the format CTS/Oztop historically store', async () => {
    mocks.verifyGa4PropertyAccess.mockResolvedValue({ ok: true })

    const result = await setGa4Property('client-1', '550203806')

    expect(mocks.verifyGa4PropertyAccess).toHaveBeenCalledWith('client-1', '550203806')
    expect(result).toEqual({ ok: true, status: 'connected', propertyId: '550203806' })
  })

  it('accepts a properties/-prefixed property id and normalizes it to bare digits before verifying', async () => {
    mocks.verifyGa4PropertyAccess.mockResolvedValue({ ok: true })

    await setGa4Property('client-1', 'properties/550203806')

    expect(mocks.verifyGa4PropertyAccess).toHaveBeenCalledWith('client-1', '550203806')
  })

  it('returns not_connected — without writing client_connectors — when no Google token resolves at all', async () => {
    mocks.verifyGa4PropertyAccess.mockResolvedValue({
      ok: false, reason: 'no_token', detail: 'no token',
    })

    const result = await setGa4Property('client-1', '550203806')

    expect(result).toEqual({ ok: false, reason: 'not_connected' })
    expect(mocks.calls.some(c => c.table === 'client_connectors')).toBe(false)
  })

  it(
    'writes client_connectors as connected (bare digits, matching CTS/Oztop convention) once verification succeeds',
    async () => {
      mocks.verifyGa4PropertyAccess.mockResolvedValue({ ok: true })

      await setGa4Property('client-1', 'properties/550203806')

      const write = mocks.calls.find(c => c.table === 'client_connectors' && c.method === 'upsert')
      expect(write).toBeDefined()
      const [row, opts] = write!.args as [Record<string, unknown>, Record<string, unknown>]
      expect(row).toEqual(expect.objectContaining({
        client_id: 'client-1',
        anchor:    'ga4',
        status:    'connected',
        config:    { property_id: '550203806' },
      }))
      expect(opts).toEqual(expect.objectContaining({ onConflict: 'client_id,anchor' }))
    },
  )

  it('property with no traffic yet but a successful API call still counts as connected (no-data ≠ no-access)', async () => {
    mocks.verifyGa4PropertyAccess.mockResolvedValue({ ok: true })

    const result = await setGa4Property('client-1', '550203806')

    expect(result).toEqual({ ok: true, status: 'connected', propertyId: '550203806' })
  })

  it('writes status:error with the reason + detail when the account has no permission on this property', async () => {
    mocks.verifyGa4PropertyAccess.mockResolvedValue({
      ok: false, reason: 'permission_denied', detail: 'no access',
    })

    const result = await setGa4Property('client-1', '550203806')

    expect(result).toEqual({
      ok: true, status: 'error', propertyId: '550203806',
      reason: 'permission_denied', detail: 'no access',
    })
    const write = mocks.calls.find(c => c.table === 'client_connectors' && c.method === 'upsert')
    const [row] = write!.args as [Record<string, unknown>]
    expect(row).toEqual(expect.objectContaining({
      status: 'error',
      config: { property_id: '550203806', error_reason: 'permission_denied', error_detail: 'no access' },
    }))
  })

  it('writes status:error when the property id does not resolve to any GA4 resource', async () => {
    mocks.verifyGa4PropertyAccess.mockResolvedValue({
      ok: false, reason: 'not_found', detail: 'no such property',
    })

    const result = await setGa4Property('client-1', '999999999')

    expect(result).toEqual({
      ok: true, status: 'error', propertyId: '999999999',
      reason: 'not_found', detail: 'no such property',
    })
  })
})
