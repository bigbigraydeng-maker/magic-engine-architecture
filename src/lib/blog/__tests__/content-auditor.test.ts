/**
 * TDD: RED phase — tests for P8.2.3 content-auditor extension.
 *
 * Tests the new fetchSitePagesAsCandidates function and the extended
 * auditExistingContent that now merges DB-sourced pages with web-crawled ones.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

vi.mock('@/lib/brief/jina', () => ({
  fetchUrlAsMarkdown: vi.fn(),
}))

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: JSON.stringify({ action: 'new', confidence: 0.9, reason: 'No conflict.' }) } }],
        }),
      },
    },
  })),
}))

import { fetchSitePagesAsCandidates, auditExistingContent } from '../content-auditor'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchUrlAsMarkdown } from '@/lib/brief/jina'

const mockFrom = vi.mocked(supabaseAdmin.from)
const mockFetchUrl = vi.mocked(fetchUrlAsMarkdown)

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

const DB_PAGES = [
  {
    id: 'p1',
    url: 'https://example.com/china-tours',
    title: 'China Tours NZ',
    page_type: 'service',
    topics: ['china', 'tours'],
    primary_keyword: 'china tours nz',
  },
  {
    id: 'p2',
    url: 'https://example.com/about',
    title: 'About Us',
    page_type: 'about',
    topics: ['company'],
    primary_keyword: null,
  },
  {
    id: 'p3',
    url: 'https://example.com/beijing-day-trips',
    title: null,
    page_type: 'blog',
    topics: ['beijing', 'tours'],
    primary_keyword: 'beijing day trips',
  },
]

// ---------------------------------------------------------------------------
// fetchSitePagesAsCandidates
// ---------------------------------------------------------------------------

describe('fetchSitePagesAsCandidates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array on DB error', async () => {
    mockFrom.mockReturnValue(makeChain(null, { message: 'DB error' }) as unknown as ReturnType<typeof mockFrom>)
    const result = await fetchSitePagesAsCandidates('client-abc')
    expect(result).toEqual([])
  })

  it('returns empty array when DB returns null', async () => {
    mockFrom.mockReturnValue(makeChain(null, null) as unknown as ReturnType<typeof mockFrom>)
    const result = await fetchSitePagesAsCandidates('client-abc')
    expect(result).toEqual([])
  })

  it('maps page rows to CandidateArticle format', async () => {
    mockFrom.mockReturnValue(makeChain([DB_PAGES[0]], null) as unknown as ReturnType<typeof mockFrom>)
    const result = await fetchSitePagesAsCandidates('client-abc')
    expect(result).toHaveLength(1)
    expect(result[0].url).toBe('https://example.com/china-tours')
    expect(result[0].title).toBe('China Tours NZ')
  })

  it('uses URL slug as title fallback when title is null', async () => {
    mockFrom.mockReturnValue(makeChain([DB_PAGES[2]], null) as unknown as ReturnType<typeof mockFrom>)
    const result = await fetchSitePagesAsCandidates('client-abc')
    expect(result[0].title).toBeTruthy()
    expect(result[0].title).not.toBe('')
  })

  it('queries the client_site_pages table filtered by client_id', async () => {
    mockFrom.mockReturnValue(makeChain([], null) as unknown as ReturnType<typeof mockFrom>)
    await fetchSitePagesAsCandidates('client-abc')
    expect(mockFrom).toHaveBeenCalledWith('client_site_pages')
  })

  it('maps all returned pages', async () => {
    mockFrom.mockReturnValue(makeChain(DB_PAGES, null) as unknown as ReturnType<typeof mockFrom>)
    const result = await fetchSitePagesAsCandidates('client-abc')
    expect(result).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// auditExistingContent — with clientId (DB path)
// ---------------------------------------------------------------------------

describe('auditExistingContent with clientId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OPENAI_API_KEY = 'test-key'
    // Jina returns empty by default (no web candidates)
    mockFetchUrl.mockRejectedValue(new Error('fetch failed'))
  })

  it('returns action=new when DB has no pages', async () => {
    mockFrom.mockReturnValue(makeChain([], null) as unknown as ReturnType<typeof mockFrom>)
    const result = await auditExistingContent('https://example.com', 'china tours', undefined, 'client-abc')
    expect(result.action).toBe('new')
  })

  it('includes DB pages in discovered_urls', async () => {
    mockFrom.mockReturnValue(makeChain(DB_PAGES, null) as unknown as ReturnType<typeof mockFrom>)
    const result = await auditExistingContent('https://example.com', 'china tours', undefined, 'client-abc')
    expect(result.discovered_urls).toContain('https://example.com/china-tours')
  })

  it('falls back gracefully when DB fetch throws', async () => {
    mockFrom.mockImplementation(() => { throw new Error('DB unavailable') })
    // Should not throw — just treat DB as empty and continue with web crawl
    await expect(
      auditExistingContent('https://example.com', 'china tours', undefined, 'client-abc')
    ).resolves.toBeDefined()
  })

  it('deduplicates pages found in both DB and web crawl', async () => {
    // DB has page at /china-tours
    mockFrom.mockReturnValue(makeChain([DB_PAGES[0]], null) as unknown as ReturnType<typeof mockFrom>)
    // Web crawl also finds /china-tours
    mockFetchUrl.mockResolvedValue({
      url: 'https://example.com/blog',
      title: 'Blog',
      markdown: '[China Tours NZ](https://example.com/china-tours)',
      chars: 50,
    })
    const result = await auditExistingContent('https://example.com', 'china tours', undefined, 'client-abc')
    // /china-tours should appear only once in discovered_urls
    const count = result.discovered_urls.filter(u => u === 'https://example.com/china-tours').length
    expect(count).toBe(1)
  })

  it('backward compat: works without clientId (pure web crawl)', async () => {
    // No DB call should be made if clientId is not provided
    mockFetchUrl.mockRejectedValue(new Error('no blog'))
    const result = await auditExistingContent('https://example.com', 'china tours')
    expect(result.action).toBe('new')
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
