/**
 * Site Auditor Crawler — the two run-wide bounds on sitemap expansion, tested
 * through the real `discoverSitemapUrls()` (Codex review on PR #963, P2):
 *
 *   1. "is this an index?" is decided by the XML **root element**, shared by
 *      Level 1 and the recursive path, so a `<urlset>` that merely mentions
 *      `<sitemapindex` in a comment is still parsed as pages;
 *   2. one shared request ledger per run — every URL fetched at most once
 *      across all levels, and at most MAX_SITEMAP_FETCHES documents in total,
 *      with a single `sitemap-fetch-limit` issue when that is reached.
 *
 * The depth limit is a *separate* bound and is not retested here; see
 * crawler-discovery.test.ts, which deliberately uses distinct URLs so that
 * de-duplication cannot stand in for it.
 *
 * No network: the transport under safeFetchText is the stubbed global fetch and
 * DNS is mocked, exactly as in crawler-ssrf-guard.test.ts. Jina is mocked to
 * fail so discovery cannot escape into the Jina levels.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { discoverSitemapUrls, type DiscoveryIssue } from '../crawler'
import { MAX_SITEMAP_FETCHES } from '../sitemap-budget'
import { fetchUrlRaw, fetchUrlAsMarkdown } from '../../brief/jina'
import { ROBOTS_TXT_EMPTY, mockResponse, mockNotFound } from './crawler-fixtures'

vi.mock('../../brief/jina', () => ({
  fetchUrlAsMarkdown: vi.fn(),
  fetchUrlRaw: vi.fn(),
}))

const dnsLookupMock = vi.hoisted(() => vi.fn())
vi.mock('node:dns/promises', () => ({ lookup: dnsLookupMock, default: { lookup: dnsLookupMock } }))

vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>()
  class PassthroughAgent {
    async close(): Promise<void> {}
  }
  return {
    ...actual,
    Agent: PassthroughAgent,
    fetch: (input: unknown, init?: unknown) =>
      (globalThis.fetch as unknown as (i: unknown, n?: unknown) => Promise<Response>)(input, init),
  }
})

const PUBLIC_DNS_ANSWER = [{ address: '93.184.216.34', family: 4 }]

const index = (locs: string[]): string =>
  `<sitemapindex>${locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join('')}</sitemapindex>`
const urlset = (locs: string[]): string =>
  `<urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`

/**
 * Serve a fixed map of URL → body. Everything unlisted 404s, and every call is
 * recorded so the tests can count *requests*, not just results.
 */
function serve(routes: Record<string, string>): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: unknown) => {
    const key = String(url)
    const body = routes[key]
    return body === undefined ? mockNotFound() : mockResponse(body)
  })
}

function requestedUrls(): string[] {
  return vi.mocked(globalThis.fetch).mock.calls.map(([u]) => String(u))
}

function countRequests(url: string): number {
  return requestedUrls().filter((u) => u === url).length
}

describe('discoverSitemapUrls — index detection by root element', () => {
  beforeEach(() => {
    vi.mocked(fetchUrlRaw).mockReset().mockRejectedValue(new Error('jina unavailable'))
    vi.mocked(fetchUrlAsMarkdown).mockReset().mockRejectedValue(new Error('jina unavailable'))
    dnsLookupMock.mockReset().mockResolvedValue(PUBLIC_DNS_ANSWER)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses a <urlset> whose comment contains <sitemapindex> as pages, not child sitemaps', async () => {
    const body = `<?xml version="1.0"?>
<!-- migrated from <sitemapindex> on 2026-01-01 -->
${urlset(['https://example.com/a', 'https://example.com/b'])}`
    vi.stubGlobal('fetch', serve({
      'https://example.com/robots.txt': ROBOTS_TXT_EMPTY,
      'https://example.com/sitemap.xml': body,
    }))

    const urls = await discoverSitemapUrls('example.com')

    expect(urls).toEqual(['https://example.com/a', 'https://example.com/b'])
    // The page URLs are results, never requests — nothing was expanded.
    expect(countRequests('https://example.com/a')).toBe(0)
    expect(countRequests('https://example.com/b')).toBe(0)
  })

  it('still recurses into a real index carrying a declaration, comments and attributes', async () => {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<!-- generated -->
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-posts.xml</loc></sitemap>
</sitemapindex>`
    vi.stubGlobal('fetch', serve({
      'https://example.com/robots.txt': ROBOTS_TXT_EMPTY,
      'https://example.com/sitemap.xml': body,
      'https://example.com/sitemap-posts.xml': urlset(['https://example.com/p1', 'https://example.com/p2']),
    }))

    const urls = await discoverSitemapUrls('example.com')

    expect(urls).toEqual(['https://example.com/p1', 'https://example.com/p2'])
    expect(countRequests('https://example.com/sitemap-posts.xml')).toBe(1)
  })

  /**
   * Level 1 and the recursive path must share one criterion. A nested index
   * reached through recursion carries the same prolog noise as the top-level
   * one, so if the two disagreed this would come back with the child sitemap
   * documents instead of the pages behind them.
   */
  it('applies the same root-element criterion at Level 1 and inside the recursion', async () => {
    const nested = `<?xml version="1.0"?><!-- <sitemapindex> in a comment -->
${index(['https://example.com/sitemap-deep.xml'])}`
    const leafWithDecoyComment = `<?xml version="1.0"?><!-- <sitemapindex> again -->
${urlset(['https://example.com/deep-1'])}`
    vi.stubGlobal('fetch', serve({
      'https://example.com/robots.txt': ROBOTS_TXT_EMPTY,
      'https://example.com/sitemap.xml': index(['https://example.com/sitemap-nested.xml']),
      'https://example.com/sitemap-nested.xml': nested,
      'https://example.com/sitemap-deep.xml': leafWithDecoyComment,
    }))

    const urls = await discoverSitemapUrls('example.com')

    // The nested index recursed; the leaf's decoy comment did not make the
    // recursive path treat its page <loc> as another sitemap.
    expect(urls).toEqual(['https://example.com/deep-1'])
    expect(countRequests('https://example.com/deep-1')).toBe(0)
  })
})

describe('discoverSitemapUrls — one shared sitemap request budget per run', () => {
  beforeEach(() => {
    vi.mocked(fetchUrlRaw).mockReset().mockRejectedValue(new Error('jina unavailable'))
    vi.mocked(fetchUrlAsMarkdown).mockReset().mockRejectedValue(new Error('jina unavailable'))
    dnsLookupMock.mockReset().mockResolvedValue(PUBLIC_DNS_ANSWER)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requests a child sitemap listed twice in the same index only once', async () => {
    const child = 'https://example.com/sitemap-posts.xml'
    vi.stubGlobal('fetch', serve({
      'https://example.com/robots.txt': ROBOTS_TXT_EMPTY,
      'https://example.com/sitemap.xml': index([child, child, child]),
      [child]: urlset(['https://example.com/p1', 'https://example.com/p2']),
    }))

    const urls = await discoverSitemapUrls('example.com')

    expect(urls).toEqual(['https://example.com/p1', 'https://example.com/p2'])
    expect(countRequests(child)).toBe(1)
  })

  it('requests a URL that recurs across recursion levels only once', async () => {
    // sitemap.xml -> a -> (b, sitemap.xml) ; b -> a. Every back-edge is a URL
    // some earlier level already fetched.
    vi.stubGlobal('fetch', serve({
      'https://example.com/robots.txt': ROBOTS_TXT_EMPTY,
      'https://example.com/sitemap.xml': index(['https://example.com/a.xml']),
      'https://example.com/a.xml': index(['https://example.com/b.xml', 'https://example.com/sitemap.xml']),
      'https://example.com/b.xml': index(['https://example.com/a.xml']),
    }))

    await discoverSitemapUrls('example.com')

    expect(countRequests('https://example.com/sitemap.xml')).toBe(1)
    expect(countRequests('https://example.com/a.xml')).toBe(1)
    expect(countRequests('https://example.com/b.xml')).toBe(1)
  })

  it('stops at MAX_SITEMAP_FETCHES unique children and reports sitemap-fetch-limit once', async () => {
    const children = Array.from({ length: 60 }, (_, i) => `https://example.com/sitemap-${i}.xml`)
    const routes: Record<string, string> = {
      'https://example.com/robots.txt': ROBOTS_TXT_EMPTY,
      'https://example.com/sitemap.xml': index(children),
    }
    children.forEach((c, i) => { routes[c] = urlset([`https://example.com/page-${i}`]) })
    vi.stubGlobal('fetch', serve(routes))
    const issues: DiscoveryIssue[] = []

    await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

    // Level 1's own /sitemap.xml read is charged to the same allowance, so the
    // run performs exactly MAX_SITEMAP_FETCHES sitemap requests in total.
    const sitemapRequests = requestedUrls().filter((u) => u.includes('/sitemap'))
    expect(sitemapRequests).toHaveLength(MAX_SITEMAP_FETCHES)
    const limitIssues = issues.filter((i) => i.stage === 'sitemap-fetch-limit')
    expect(limitIssues).toHaveLength(1)
  })

  it('keeps the pages discovered before the limit was reached', async () => {
    const children = Array.from({ length: 60 }, (_, i) => `https://example.com/sitemap-${i}.xml`)
    const routes: Record<string, string> = {
      'https://example.com/robots.txt': ROBOTS_TXT_EMPTY,
      'https://example.com/sitemap.xml': index(children),
    }
    children.forEach((c, i) => { routes[c] = urlset([`https://example.com/page-${i}`]) })
    vi.stubGlobal('fetch', serve(routes))

    const urls = await discoverSitemapUrls('example.com')

    // 49 children fetched (the 50th slot went to /sitemap.xml itself), one page
    // each — truncated, but not discarded.
    expect(urls).toHaveLength(MAX_SITEMAP_FETCHES - 1)
    expect(urls[0]).toBe('https://example.com/page-0')
  })

  it('does not hand a deeper recursion level a fresh allowance', async () => {
    // A wide index whose children are themselves indexes: without one shared
    // ledger, level 2 would get its own 50 and the run would blow past the cap.
    const firstLevel = Array.from({ length: 40 }, (_, i) => `https://example.com/l1-${i}.xml`)
    const routes: Record<string, string> = {
      'https://example.com/robots.txt': ROBOTS_TXT_EMPTY,
      'https://example.com/sitemap.xml': index(firstLevel),
    }
    firstLevel.forEach((u, i) => {
      const grandChildren = Array.from({ length: 40 }, (_, j) => `https://example.com/l2-${i}-${j}.xml`)
      routes[u] = index(grandChildren)
      grandChildren.forEach((g, j) => { routes[g] = urlset([`https://example.com/deep-${i}-${j}`]) })
    })
    vi.stubGlobal('fetch', serve(routes))
    const issues: DiscoveryIssue[] = []

    await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

    const sitemapRequests = requestedUrls().filter((u) => u.includes('/sitemap') || u.includes('/l1-') || u.includes('/l2-'))
    expect(sitemapRequests).toHaveLength(MAX_SITEMAP_FETCHES)
    expect(issues.filter((i) => i.stage === 'sitemap-fetch-limit')).toHaveLength(1)
  })

  it('shares the allowance between the robots.txt directives and Level 1', async () => {
    // robots.txt names /sitemap.xml, which Level 1 would otherwise request a
    // second time.
    const robots = 'User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml'
    vi.stubGlobal('fetch', serve({
      'https://example.com/robots.txt': robots,
      'https://example.com/sitemap.xml': urlset(['https://example.com/a', 'https://example.com/b']),
    }))

    const urls = await discoverSitemapUrls('example.com')

    expect(urls).toEqual(['https://example.com/a', 'https://example.com/b'])
    expect(countRequests('https://example.com/sitemap.xml')).toBe(1)
  })

  /**
   * 🔴 Codex review on PR #963 (P2). De-duplication is right — the shared
   *    sitemap must only be READ once — but the level that reaches it second
   *    used to see nothing, and the old "best single level wins" rule then
   *    silently returned one page instead of two.
   */
  it('merges pages found by the robots directive and Level 1 instead of keeping only the longer one', async () => {
    const robots = 'User-agent: *\nAllow: /\n\nSitemap: https://example.com/shared.xml'
    vi.stubGlobal('fetch', serve({
      'https://example.com/robots.txt': robots,
      // Named by robots.txt AND listed again by Level 1's index.
      'https://example.com/shared.xml': urlset(['https://example.com/a']),
      'https://example.com/sitemap.xml': index([
        'https://example.com/shared.xml',
        'https://example.com/other.xml',
      ]),
      'https://example.com/other.xml': urlset(['https://example.com/b']),
    }))

    const urls = await discoverSitemapUrls('example.com')

    // Neither level reached MIN_DISCOVERED_URLS alone; together they do.
    expect(urls).toEqual(['https://example.com/a', 'https://example.com/b'])
    // …and the shared sitemap was still only requested once for the whole run.
    expect(countRequests('https://example.com/shared.xml')).toBe(1)
  })

  it('keeps the accumulated sitemap pages in the final partial best-effort result', async () => {
    // robots directive yields one page; every sitemap level then dead-ends and
    // the homepage BFS finds one different link. Neither reaches the threshold,
    // so the run ends in partial-best-effort — which must return both, not the
    // single longest source.
    const robots = 'User-agent: *\nAllow: /\n\nSitemap: https://example.com/shared.xml'
    vi.stubGlobal('fetch', serve({
      'https://example.com/robots.txt': robots,
      'https://example.com/shared.xml': urlset(['https://example.com/a']),
      'https://example.com': '<html><a href="/c">c</a></html>',
    }))
    const issues: DiscoveryIssue[] = []

    const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

    expect(urls).toEqual(expect.arrayContaining([
      'https://example.com/a',
      'https://example.com/c',
    ]))
    expect(urls).toHaveLength(2)
    expect(issues.some((i) => i.stage === 'partial-best-effort')).toBe(true)
  })

  it('continues with the remaining siblings after one child fails', async () => {
    vi.stubGlobal('fetch', serve({
      'https://example.com/robots.txt': ROBOTS_TXT_EMPTY,
      'https://example.com/sitemap.xml': index([
        'https://example.com/missing.xml',
        'https://example.com/sitemap-pages.xml',
      ]),
      // missing.xml is unlisted => 404
      'https://example.com/sitemap-pages.xml': urlset(['https://example.com/about', 'https://example.com/contact']),
    }))
    const issues: DiscoveryIssue[] = []

    const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

    expect(urls).toEqual(['https://example.com/about', 'https://example.com/contact'])
    expect(issues).toContainEqual(
      expect.objectContaining({ stage: 'sitemap-fetch', url: 'https://example.com/missing.xml' })
    )
  })
})
