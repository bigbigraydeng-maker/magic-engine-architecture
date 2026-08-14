/**
 * Site Auditor Crawler — integration guard: every sitemap read goes through the
 * shared connection-bound primitive, and nothing goes around it.
 *
 * 🔴 Why this file exists separately from crawler-ssrf-guard.test.ts:
 *    that file swaps only undici's socket, so the REAL safeFetchText runs and a
 *    raw `fetch(childUrl)` regression would still reach the same global fetch
 *    mock — indistinguishable from the guarded path. This file mocks
 *    safeFetchText itself, so "read through the primitive" and "read through a
 *    raw fetch" become two different, observable channels. Reintroducing a
 *    direct fetch() on any sitemap URL fails here immediately.
 *
 *    The two files are complementary and neither is sufficient alone: this one
 *    proves the wiring, that one proves the wiring actually blocks things.
 *
 * The address rules, DNS resolve-all, connection pinning and per-hop redirect
 * validation are NOT retested here — they are owned and tested by
 * src/lib/net/safe-fetch.ts (issue #965 / PR #970). Duplicating them would
 * recreate the second, divergent policy that #963 was told to delete.
 *
 * No network: safeFetchText is mocked, the global fetch is stubbed, and Jina is
 * mocked to fail.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Headers } from 'undici'
import { safeFetchText, BlockedAddressError } from '@/lib/net/safe-fetch'
import { discoverSitemapUrls, type DiscoveryIssue } from '../crawler'
import { fetchUrlRaw, fetchUrlAsMarkdown } from '../../brief/jina'
import { ROBOTS_TXT_EMPTY, mockResponse, mockNotFound } from './crawler-fixtures'

vi.mock('../../brief/jina', () => ({
  fetchUrlAsMarkdown: vi.fn(),
  fetchUrlRaw: vi.fn(),
}))

// Real error classes kept: crawler.ts maps them onto DiscoveryIssue stages with
// `instanceof`, which a fully synthetic module would silently break.
vi.mock('@/lib/net/safe-fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/net/safe-fetch')>()
  return { ...actual, safeFetchText: vi.fn() }
})

const safeFetchTextMock = vi.mocked(safeFetchText)

function textResponse(text: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Not Found',
    url: '',
    headers: new Headers(),
    hops: 0,
    text,
  }
}

const SITEMAP_INDEX = `<sitemapindex>
  <sitemap><loc>https://example.com/sitemap-posts.xml</loc></sitemap>
</sitemapindex>`
const SITEMAP_POSTS = `<urlset>
  <url><loc>https://example.com/post-1</loc></url>
  <url><loc>https://example.com/post-2</loc></url>
</urlset>`

/** URLs handed to the raw global fetch — sitemap URLs must never appear here. */
function rawFetchUrls(): string[] {
  return vi.mocked(globalThis.fetch).mock.calls.map(([u]) => String(u))
}

/** URLs handed to the shared primitive. */
function safeFetchUrls(): string[] {
  return safeFetchTextMock.mock.calls.map(([u]) => String(u))
}

describe('discoverSitemapUrls — sitemap reads are delegated to safeFetchText (#965 / #970)', () => {
  beforeEach(() => {
    // robots.txt allows everything; every other raw fetch 404s, so discovery
    // falls through the levels without a raw sitemap read ever succeeding.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) =>
        String(url).endsWith('/robots.txt') ? mockResponse(ROBOTS_TXT_EMPTY) : mockNotFound()
      )
    )
    vi.mocked(fetchUrlRaw).mockReset().mockRejectedValue(new Error('jina unavailable'))
    vi.mocked(fetchUrlAsMarkdown).mockReset().mockRejectedValue(new Error('jina unavailable'))
    safeFetchTextMock.mockReset().mockResolvedValue(textResponse('Not Found', 404))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads Level 1 /sitemap.xml through safeFetchText, never through a raw fetch', async () => {
    safeFetchTextMock.mockImplementation(async (url) =>
      String(url) === 'https://example.com/sitemap.xml'
        ? textResponse(SITEMAP_POSTS)
        : textResponse('Not Found', 404)
    )

    const urls = await discoverSitemapUrls('example.com')

    expect(urls).toEqual(['https://example.com/post-1', 'https://example.com/post-2'])
    expect(safeFetchUrls()).toContain('https://example.com/sitemap.xml')
    expect(rawFetchUrls()).not.toContain('https://example.com/sitemap.xml')
  })

  it('reads Level 2 /sitemap_index.xml through safeFetchText, never through a raw fetch', async () => {
    safeFetchTextMock.mockImplementation(async (url) => {
      if (String(url) === 'https://example.com/sitemap_index.xml') return textResponse(SITEMAP_INDEX)
      if (String(url) === 'https://example.com/sitemap-posts.xml') return textResponse(SITEMAP_POSTS)
      return textResponse('Not Found', 404)
    })

    const urls = await discoverSitemapUrls('example.com')

    expect(urls).toEqual(['https://example.com/post-1', 'https://example.com/post-2'])
    expect(safeFetchUrls()).toContain('https://example.com/sitemap_index.xml')
    expect(rawFetchUrls()).not.toContain('https://example.com/sitemap_index.xml')
  })

  it('expands a sitemap index child through safeFetchText, never through a raw fetch', async () => {
    safeFetchTextMock.mockImplementation(async (url) => {
      if (String(url) === 'https://example.com/sitemap.xml') return textResponse(SITEMAP_INDEX)
      if (String(url) === 'https://example.com/sitemap-posts.xml') return textResponse(SITEMAP_POSTS)
      return textResponse('Not Found', 404)
    })

    const urls = await discoverSitemapUrls('example.com')

    expect(urls).toEqual(['https://example.com/post-1', 'https://example.com/post-2'])
    expect(safeFetchUrls()).toContain('https://example.com/sitemap-posts.xml')
    expect(rawFetchUrls()).not.toContain('https://example.com/sitemap-posts.xml')
  })

  it('reads a robots.txt Sitemap: directive through safeFetchText, never through a raw fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) =>
        String(url).endsWith('/robots.txt')
          ? mockResponse('User-agent: *\nAllow: /\n\nSitemap: https://example.com/custom-sitemap.xml')
          : mockNotFound()
      )
    )
    safeFetchTextMock.mockImplementation(async (url) =>
      String(url) === 'https://example.com/custom-sitemap.xml'
        ? textResponse(SITEMAP_POSTS)
        : textResponse('Not Found', 404)
    )

    const urls = await discoverSitemapUrls('example.com')

    expect(urls).toEqual(['https://example.com/post-1', 'https://example.com/post-2'])
    expect(safeFetchUrls()).toContain('https://example.com/custom-sitemap.xml')
    expect(rawFetchUrls()).not.toContain('https://example.com/custom-sitemap.xml')
  })

  it('delegates the redirect cap to the primitive instead of looping itself', async () => {
    await discoverSitemapUrls('example.com')

    expect(safeFetchTextMock).toHaveBeenCalled()
    for (const [, options] of safeFetchTextMock.mock.calls) {
      expect(options).toEqual({ maxRedirects: 3, maxResponseBytes: 52_428_800 })
    }
  })

  /**
   * Codex review on PR #963 (P2): safeFetchText's 10 MiB default is below the
   * 50 MB the sitemap protocol allows, so a large but legal sitemap would fail
   * where the previous unbounded fetch() succeeded. The read must stay bounded
   * — this asserts the configured bound, it does not build a 50 MB fixture.
   */
  it('bounds every sitemap read at the sitemap protocol limit, not the 10 MiB default', async () => {
    safeFetchTextMock.mockImplementation(async (url) => {
      if (String(url) === 'https://example.com/sitemap.xml') return textResponse(SITEMAP_INDEX)
      if (String(url) === 'https://example.com/sitemap-posts.xml') return textResponse(SITEMAP_POSTS)
      return textResponse('Not Found', 404)
    })

    await discoverSitemapUrls('example.com')

    const readUrls = safeFetchUrls()
    // Both the top-level read and the index-child expansion are covered.
    expect(readUrls).toContain('https://example.com/sitemap.xml')
    expect(readUrls).toContain('https://example.com/sitemap-posts.xml')
    for (const [url, options] of safeFetchTextMock.mock.calls) {
      expect(options?.maxResponseBytes, String(url)).toBe(52_428_800)
      expect(options?.maxResponseBytes, String(url)).not.toBe(10 * 1024 * 1024)
    }
  })

  it('continues with the sibling sitemaps when the shared guard rejects one child', async () => {
    const index = `<sitemapindex>
  <sitemap><loc>http://169.254.169.254/latest/meta-data/</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-posts.xml</loc></sitemap>
</sitemapindex>`
    safeFetchTextMock.mockImplementation(async (url) => {
      if (String(url) === 'https://example.com/sitemap.xml') return textResponse(index)
      if (String(url) === 'https://example.com/sitemap-posts.xml') return textResponse(SITEMAP_POSTS)
      if (String(url).includes('169.254.169.254')) {
        throw new BlockedAddressError('169.254.169.254', '169.254.169.254', 'linkLocal')
      }
      return textResponse('Not Found', 404)
    })
    const issues: DiscoveryIssue[] = []

    const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

    // The rejected child neither aborts the expansion nor drops its siblings.
    expect(urls).toEqual(['https://example.com/post-1', 'https://example.com/post-2'])
    expect(issues).toContainEqual(
      expect.objectContaining({
        stage: 'sitemap-blocked-host',
        url: 'http://169.254.169.254/latest/meta-data/',
      })
    )
  })

  it('keeps /sitemap.xml 404 a silent fallback, not a reported failure', async () => {
    safeFetchTextMock.mockImplementation(async (url) => {
      if (String(url) === 'https://example.com/sitemap_index.xml') return textResponse(SITEMAP_INDEX)
      if (String(url) === 'https://example.com/sitemap-posts.xml') return textResponse(SITEMAP_POSTS)
      return textResponse('Not Found', 404) // includes /sitemap.xml
    })
    const issues: DiscoveryIssue[] = []

    const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

    expect(urls).toEqual(['https://example.com/post-1', 'https://example.com/post-2'])
    expect(issues).toEqual([])
  })
})
