/**
 * TDD: RED phase — tests written before implementation.
 * pages-context.ts provides two things:
 *   1. fetchRelatedPages — DB query scoped to clientId, topic-matched
 *   2. buildPagesContextBlock — pure formatter for GPT-4o prompt injection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import { fetchRelatedPages, buildPagesContextBlock } from '../pages-context'
import { supabaseAdmin } from '@/lib/supabase'
import type { RelatedPageSummary } from '../pages-context'

const mockFrom = vi.mocked(supabaseAdmin.from)

function makeChain(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
  }
  chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) => {
    resolve({ data, error })
    return Promise.resolve({ data, error })
  }
  return chain
}

const CLIENT_ID = 'client-xyz'

const PAGE_A: RelatedPageSummary = {
  id: 'page-1',
  url: 'https://example.com/china-tours',
  title: 'China Tours NZ',
  page_type: 'service',
  word_count: 1200,
  topics: ['china', 'tours', 'travel'],
  primary_keyword: 'china tours nz',
  has_geo_block: true,
}

const PAGE_B: RelatedPageSummary = {
  id: 'page-2',
  url: 'https://example.com/about',
  title: 'About Us',
  page_type: 'about',
  word_count: 300,
  topics: ['company', 'team'],
  primary_keyword: 'about magic travel',
  has_geo_block: false,
}

const PAGE_C: RelatedPageSummary = {
  id: 'page-3',
  url: 'https://example.com/beijing-tours',
  title: null,
  page_type: 'blog',
  word_count: null,
  topics: ['beijing', 'tours', 'china'],
  primary_keyword: null,
  has_geo_block: false,
}

// ---------------------------------------------------------------------------
// fetchRelatedPages
// ---------------------------------------------------------------------------

describe('fetchRelatedPages', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array on DB error', async () => {
    mockFrom.mockReturnValue(makeChain(null, { message: 'DB error' }) as unknown as ReturnType<typeof mockFrom>)
    const result = await fetchRelatedPages(CLIENT_ID, 'china tours')
    expect(result).toEqual([])
  })

  it('returns empty array when DB returns null', async () => {
    mockFrom.mockReturnValue(makeChain(null, null) as unknown as ReturnType<typeof mockFrom>)
    const result = await fetchRelatedPages(CLIENT_ID, 'china tours')
    expect(result).toEqual([])
  })

  it('returns empty array when no pages match the topic', async () => {
    mockFrom.mockReturnValue(makeChain([PAGE_B], null) as unknown as ReturnType<typeof mockFrom>)
    const result = await fetchRelatedPages(CLIENT_ID, 'china tours nz')
    expect(result).toEqual([])
  })

  it('returns pages that match via topics array', async () => {
    mockFrom.mockReturnValue(makeChain([PAGE_A, PAGE_B], null) as unknown as ReturnType<typeof mockFrom>)
    const result = await fetchRelatedPages(CLIENT_ID, 'best china tours')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('page-1')
  })

  it('returns pages that match via primary_keyword', async () => {
    mockFrom.mockReturnValue(makeChain([PAGE_B], null) as unknown as ReturnType<typeof mockFrom>)
    const result = await fetchRelatedPages(CLIENT_ID, 'magic travel company')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('page-2')
  })

  it('ignores stop words shorter than 4 chars when matching', async () => {
    // topic "the nz" — both words < 4 chars, should match nothing even if a page has "nz"
    mockFrom.mockReturnValue(makeChain([PAGE_A], null) as unknown as ReturnType<typeof mockFrom>)
    const result = await fetchRelatedPages(CLIENT_ID, 'the nz')
    expect(result).toEqual([])
  })

  it('sorts results by word_count descending (most comprehensive first)', async () => {
    mockFrom.mockReturnValue(makeChain([PAGE_C, PAGE_A], null) as unknown as ReturnType<typeof mockFrom>)
    // both PAGE_A and PAGE_C have "tours" topic
    const result = await fetchRelatedPages(CLIENT_ID, 'tours china travel')
    expect(result[0].id).toBe('page-1') // 1200 words
    expect(result[1].id).toBe('page-3') // null → treated as 0
  })

  it('respects the limit parameter', async () => {
    const manyPages = Array.from({ length: 10 }, (_, i) => ({
      ...PAGE_A,
      id: `page-${i}`,
      url: `https://example.com/page-${i}`,
    }))
    mockFrom.mockReturnValue(makeChain(manyPages, null) as unknown as ReturnType<typeof mockFrom>)
    const result = await fetchRelatedPages(CLIENT_ID, 'china tours', 3)
    expect(result).toHaveLength(3)
  })

  it('queries the correct table with client_id filter', async () => {
    mockFrom.mockReturnValue(makeChain([], null) as unknown as ReturnType<typeof mockFrom>)
    await fetchRelatedPages(CLIENT_ID, 'some topic')
    expect(mockFrom).toHaveBeenCalledWith('client_site_pages')
  })
})

// ---------------------------------------------------------------------------
// buildPagesContextBlock
// ---------------------------------------------------------------------------

describe('buildPagesContextBlock', () => {
  it('returns empty string for empty array', () => {
    expect(buildPagesContextBlock([])).toBe('')
  })

  it('includes a header describing the purpose', () => {
    const result = buildPagesContextBlock([PAGE_A])
    expect(result).toContain('EXISTING CONTENT')
  })

  it('includes page URL', () => {
    const result = buildPagesContextBlock([PAGE_A])
    expect(result).toContain('https://example.com/china-tours')
  })

  it('includes page title when present', () => {
    const result = buildPagesContextBlock([PAGE_A])
    expect(result).toContain('China Tours NZ')
  })

  it('uses URL hostname as fallback when title is null', () => {
    const result = buildPagesContextBlock([PAGE_C])
    expect(result).toContain('example.com')
  })

  it('includes page_type', () => {
    const result = buildPagesContextBlock([PAGE_A])
    expect(result).toContain('service')
  })

  it('includes word_count when present', () => {
    const result = buildPagesContextBlock([PAGE_A])
    expect(result).toContain('1,200')
  })

  it('shows "unknown length" when word_count is null', () => {
    const result = buildPagesContextBlock([PAGE_C])
    expect(result).toContain('unknown length')
  })

  it('includes all pages when multiple provided', () => {
    const result = buildPagesContextBlock([PAGE_A, PAGE_C])
    expect(result).toContain('china-tours')
    expect(result).toContain('beijing-tours')
  })

  it('instructs GPT-4o to write from a different angle', () => {
    const result = buildPagesContextBlock([PAGE_A])
    expect(result.toLowerCase()).toMatch(/different angle|do not duplicate|do not repeat|avoid overlap/i)
  })
})
