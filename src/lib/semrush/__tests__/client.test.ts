/**
 * TDD — RED Phase
 * Tests for SEMrush client.ts — runtime API key validation.
 *
 * Covers CRITICAL-2: SEMRUSH_API_KEY uses non-null assertion (!)
 * which hides undefined at runtime. Must throw clearly when key is missing.
 *
 * Mock strategy: fetch is mocked globally; env vars are set/unset per test.
 *
 * Reference: Phase 7.3 security fix
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOkResponse(csvText: string) {
  return Promise.resolve({
    ok: true,
    text: async () => csvText,
    status: 200,
  } as Response)
}

function makeErrorResponse(status: number) {
  return Promise.resolve({
    ok: false,
    text: async () => '',
    status,
  } as Response)
}

// Minimal valid SEMrush CSV (header + 1 row)
const VALID_CSV = 'Keyword;Search Volume;KD;CPC;Intent\nchina tours;1000;45;2.5;commercial'

// ---------------------------------------------------------------------------
// Setup: restore env between tests
// ---------------------------------------------------------------------------

let savedApiKey: string | undefined
let savedDb: string | undefined

beforeEach(() => {
  savedApiKey = process.env.SEMRUSH_API_KEY
  savedDb = process.env.SEMRUSH_DB
  mockFetch.mockReset()
})

afterEach(() => {
  if (savedApiKey !== undefined) {
    process.env.SEMRUSH_API_KEY = savedApiKey
  } else {
    delete process.env.SEMRUSH_API_KEY
  }

  if (savedDb !== undefined) {
    process.env.SEMRUSH_DB = savedDb
  } else {
    delete process.env.SEMRUSH_DB
  }
  vi.resetModules()
})

// ---------------------------------------------------------------------------
// Tests: batchKeywordOverview
// ---------------------------------------------------------------------------

describe('batchKeywordOverview — API key validation', () => {
  it('throws a descriptive error when SEMRUSH_API_KEY is undefined', async () => {
    delete process.env.SEMRUSH_API_KEY
    // Re-import module so it re-reads env
    const { batchKeywordOverview } = await import('../client')

    await expect(batchKeywordOverview(['test keyword'])).rejects.toThrow(
      /SEMRUSH_API_KEY/
    )
  })

  it('throws a descriptive error when SEMRUSH_API_KEY is empty string', async () => {
    process.env.SEMRUSH_API_KEY = ''
    const { batchKeywordOverview } = await import('../client')

    await expect(batchKeywordOverview(['test keyword'])).rejects.toThrow(
      /SEMRUSH_API_KEY/
    )
  })

  it('does NOT call fetch when API key is missing', async () => {
    delete process.env.SEMRUSH_API_KEY
    const { batchKeywordOverview } = await import('../client')

    await expect(batchKeywordOverview(['test'])).rejects.toThrow()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('succeeds when SEMRUSH_API_KEY is set', async () => {
    process.env.SEMRUSH_API_KEY = 'valid-key-123'
    mockFetch.mockImplementation(() => makeOkResponse(VALID_CSV))

    const { batchKeywordOverview } = await import('../client')
    const result = await batchKeywordOverview(['china tours'])

    expect(mockFetch).toHaveBeenCalledOnce()
    // Verify key appears in the request URL
    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('valid-key-123')
    expect(result).toBeInstanceOf(Array)
  })

  it('error message from missing key does NOT contain the key value', async () => {
    process.env.SEMRUSH_API_KEY = ''
    const { batchKeywordOverview } = await import('../client')

    try {
      await batchKeywordOverview(['test'])
      expect.fail('should have thrown')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      // Error must reference the variable name, not expose credentials
      expect(msg).toMatch(/SEMRUSH_API_KEY/)
    }
  })
})

// ---------------------------------------------------------------------------
// Tests: getRelatedKeywords
// ---------------------------------------------------------------------------

describe('getRelatedKeywords — API key validation', () => {
  it('throws when SEMRUSH_API_KEY is missing', async () => {
    delete process.env.SEMRUSH_API_KEY
    const { getRelatedKeywords } = await import('../client')

    await expect(getRelatedKeywords('china tours')).rejects.toThrow(/SEMRUSH_API_KEY/)
  })

  it('calls fetch with key in URL when key is set', async () => {
    process.env.SEMRUSH_API_KEY = 'my-semrush-key'
    mockFetch.mockImplementation(() => makeOkResponse(VALID_CSV))

    const { getRelatedKeywords } = await import('../client')
    await getRelatedKeywords('china tours')

    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('my-semrush-key')
  })
})

// ---------------------------------------------------------------------------
// Tests: getDomainOrganicKeywords
// ---------------------------------------------------------------------------

describe('getDomainOrganicKeywords — API key validation', () => {
  it('throws when SEMRUSH_API_KEY is missing', async () => {
    delete process.env.SEMRUSH_API_KEY
    const { getDomainOrganicKeywords } = await import('../client')

    await expect(getDomainOrganicKeywords('example.com')).rejects.toThrow(/SEMRUSH_API_KEY/)
  })
})

// ---------------------------------------------------------------------------
// Tests: getKeywordGap
// ---------------------------------------------------------------------------

describe('getKeywordGap — API key validation', () => {
  it('throws when SEMRUSH_API_KEY is missing', async () => {
    delete process.env.SEMRUSH_API_KEY
    const { getKeywordGap } = await import('../client')

    await expect(getKeywordGap('my.com', ['comp.com'])).rejects.toThrow(/SEMRUSH_API_KEY/)
  })
})

// ---------------------------------------------------------------------------
// Tests: getDomainMetrics
// ---------------------------------------------------------------------------

describe('getDomainMetrics — API key validation', () => {
  it('throws when SEMRUSH_API_KEY is missing', async () => {
    delete process.env.SEMRUSH_API_KEY
    const { getDomainMetrics } = await import('../client')

    await expect(getDomainMetrics('example.com')).rejects.toThrow(/SEMRUSH_API_KEY/)
  })
})

// ---------------------------------------------------------------------------
// Tests: getQuestionKeywords
// ---------------------------------------------------------------------------

describe('getQuestionKeywords — API key validation', () => {
  it('throws when SEMRUSH_API_KEY is missing', async () => {
    delete process.env.SEMRUSH_API_KEY
    const { getQuestionKeywords } = await import('../client')

    await expect(getQuestionKeywords('best tours')).rejects.toThrow(/SEMRUSH_API_KEY/)
  })
})

// ---------------------------------------------------------------------------
// Tests: getDomainOverviewSnapshot (non-fatal wrapper)
// ---------------------------------------------------------------------------

describe('getDomainOverviewSnapshot — resilience when key is missing', () => {
  it('returns empty snapshot instead of throwing (graceful degradation)', async () => {
    delete process.env.SEMRUSH_API_KEY
    const { getDomainOverviewSnapshot } = await import('../client')

    // This wrapper is documented as non-fatal; it catches errors internally
    const result = await getDomainOverviewSnapshot('example.com')
    expect(result).toEqual({ top_keywords: [], competitor_domains: [] })
    // Fetch must NOT have been called
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Tests: SEMrush HTTP error handling
// ---------------------------------------------------------------------------

describe('SEMrush API HTTP errors', () => {
  beforeEach(() => {
    process.env.SEMRUSH_API_KEY = 'valid-key'
  })

  it('batchKeywordOverview throws on HTTP 403', async () => {
    mockFetch.mockImplementation(() => makeErrorResponse(403))
    const { batchKeywordOverview } = await import('../client')

    await expect(batchKeywordOverview(['keyword'])).rejects.toThrow(/403/)
  })

  it('batchKeywordOverview throws on HTTP 429 (rate limit)', async () => {
    mockFetch.mockImplementation(() => makeErrorResponse(429))
    const { batchKeywordOverview } = await import('../client')

    await expect(batchKeywordOverview(['keyword'])).rejects.toThrow(/429/)
  })

  it('getRelatedKeywords throws on non-ok response', async () => {
    mockFetch.mockImplementation(() => makeErrorResponse(500))
    const { getRelatedKeywords } = await import('../client')

    await expect(getRelatedKeywords('keyword')).rejects.toThrow()
  })
})
