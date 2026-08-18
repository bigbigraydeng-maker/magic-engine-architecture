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

/**
 * `existingConnector` models the pre-write `select(...).eq(...).eq(...).maybeSingle()`
 * read setGa4Property now does before ever writing a 'error' row — default
 * `null` (no prior connector row) matches every pre-existing test's assumed
 * starting state.
 */
function connectorsTable(existingConnector: { status: string; config: Record<string, unknown> | null } | null) {
  const readChain: Record<string, unknown> = {}
  ;['select', 'eq'].forEach((m) => {
    readChain[m] = vi.fn((...args: unknown[]) => { record('client_connectors', m, args); return readChain })
  })
  readChain.maybeSingle = vi.fn(() => {
    record('client_connectors', 'maybeSingle', [])
    return Promise.resolve({ data: existingConnector })
  })

  return {
    select: readChain.select,
    upsert: vi.fn((...args: unknown[]) => {
      record('client_connectors', 'upsert', args)
      return Promise.resolve({ error: null })
    }),
  }
}

function mockTables(existingConnector: { status: string; config: Record<string, unknown> | null } | null = null) {
  mocks.from.mockImplementation((table: string) => {
    if (table === 'client_connectors') return connectorsTable(existingConnector)
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
    expect(mocks.calls.some(c => c.table === 'client_connectors' && c.method === 'upsert')).toBe(false)
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

  it('writes status:error with the reason + detail when there was no prior connector and the account has no permission', async () => {
    mockTables(null)
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

  it('writes status:error when there was no prior connector and the property id does not resolve to any GA4 resource', async () => {
    mockTables(null)
    mocks.verifyGa4PropertyAccess.mockResolvedValue({
      ok: false, reason: 'not_found', detail: 'no such property',
    })

    const result = await setGa4Property('client-1', '999999999')

    expect(result).toEqual({
      ok: true, status: 'error', propertyId: '999999999',
      reason: 'not_found', detail: 'no such property',
    })
  })

  // 魏征 2026-08-18 复审: this used to be an unconditional upsert — trying and
  // failing to switch to a NEW property_id would silently clobber a
  // different, already-'connected', currently-syncing connector's row with
  // status='error', breaking live GA4 sync with no warning. These three
  // tests pin the fix: the DB write must only happen when it can't destroy
  // a working connection for a DIFFERENT property.
  describe('does not clobber an existing working connector with a different failing property', () => {
    it('leaves the existing connected row untouched — no upsert call at all — when a different property fails verification', async () => {
      mockTables({ status: 'connected', config: { property_id: '111111111' } })
      mocks.verifyGa4PropertyAccess.mockResolvedValue({
        ok: false, reason: 'permission_denied', detail: 'no access to this one',
      })

      const result = await setGa4Property('client-1', '999999999')

      // Caller still learns the attempt failed...
      expect(result).toEqual({
        ok: true, status: 'error', propertyId: '999999999',
        reason: 'permission_denied', detail: 'no access to this one',
      })
      // ...but the DB was never touched, so the working '111111111' row survives.
      expect(mocks.calls.some(c => c.table === 'client_connectors' && c.method === 'upsert')).toBe(false)
    })

    it('DOES write status:error when the failing property IS the currently-connected one (access genuinely revoked)', async () => {
      mockTables({ status: 'connected', config: { property_id: '550203806' } })
      mocks.verifyGa4PropertyAccess.mockResolvedValue({
        ok: false, reason: 'permission_denied', detail: 'access revoked',
      })

      const result = await setGa4Property('client-1', '550203806')

      expect(result).toEqual({
        ok: true, status: 'error', propertyId: '550203806',
        reason: 'permission_denied', detail: 'access revoked',
      })
      const write = mocks.calls.find(c => c.table === 'client_connectors' && c.method === 'upsert')
      expect(write).toBeDefined()
    })

    it('still writes status:error when the prior row exists but is NOT status=connected (e.g. already error, or never verified)', async () => {
      mockTables({ status: 'error', config: { property_id: '111111111', error_reason: 'not_found' } })
      mocks.verifyGa4PropertyAccess.mockResolvedValue({
        ok: false, reason: 'permission_denied', detail: 'still no access',
      })

      const result = await setGa4Property('client-1', '999999999')

      expect(result).toEqual({
        ok: true, status: 'error', propertyId: '999999999',
        reason: 'permission_denied', detail: 'still no access',
      })
      const write = mocks.calls.find(c => c.table === 'client_connectors' && c.method === 'upsert')
      expect(write).toBeDefined()
    })
  })
})
