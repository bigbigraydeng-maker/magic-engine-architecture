/**
 * Site Auditor Crawler — fetchSitemapPagesViaJina() tests (sitemap-index
 * recursion through Jina Reader, used by discoverSitemapUrls's Level 5a).
 *
 * Split out of crawler.test.ts (Codex review on PR #963, P1 — the combined
 * file exceeded the repo's 800-line-per-file cap).
 * See crawler-test-files.ts for the fixed manifest of all split files.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchSitemapPagesViaJina, type DiscoveryIssue } from '../crawler'
import { fetchUrlRaw } from '../../brief/jina'
import { SITEMAP_INDEX_XML, SITEMAP_POSTS_XML, SITEMAP_PAGES_XML } from './crawler-fixtures'

vi.mock('../../brief/jina', () => ({
  fetchUrlAsMarkdown: vi.fn(),
  fetchUrlRaw: vi.fn(),
}))

describe('fetchSitemapPagesViaJina', () => {
  beforeEach(() => {
    vi.mocked(fetchUrlRaw).mockReset()
  })

  it('recurses into child sitemaps of a sitemap index', async () => {
    vi.mocked(fetchUrlRaw).mockImplementation(async (url: string) => {
      if (url === 'https://example.com/sitemap.xml') return SITEMAP_INDEX_XML
      if (url === 'https://example.com/sitemap-posts.xml') return SITEMAP_POSTS_XML
      if (url === 'https://example.com/sitemap-pages.xml') return SITEMAP_PAGES_XML
      throw new Error(`Unexpected URL: ${url}`)
    })

    const urls = await fetchSitemapPagesViaJina('https://example.com/sitemap.xml', 0, 0)
    expect(urls).toHaveLength(6)
    expect(urls).toContain('https://example.com/post-1')
    expect(urls).toContain('https://example.com/about')
  })

  it('skips unreachable child sitemaps and keeps the rest', async () => {
    vi.mocked(fetchUrlRaw).mockImplementation(async (url: string) => {
      if (url === 'https://example.com/sitemap.xml') return SITEMAP_INDEX_XML
      if (url === 'https://example.com/sitemap-pages.xml') return SITEMAP_PAGES_XML
      throw new Error('Timeout')
    })

    const urls = await fetchSitemapPagesViaJina('https://example.com/sitemap.xml', 0, 0)
    expect(urls).toHaveLength(3)
    expect(urls).toContain('https://example.com/about')
  })

  it('fetches a self-referencing sitemap only once (Jina "URL Source:" header)', async () => {
    // Jina's markdown output repeats the fetched URL, which looks like a child
    // sitemap — the visited set must stop it from recursing into itself.
    vi.mocked(fetchUrlRaw).mockResolvedValue(
      'URL Source: https://example.com/sitemap.xml\n\nhttps://example.com/page-1'
    )

    const urls = await fetchSitemapPagesViaJina('https://example.com/sitemap.xml', 0, 0)
    expect(urls).toEqual(['https://example.com/page-1'])
    expect(vi.mocked(fetchUrlRaw)).toHaveBeenCalledTimes(1)
  })

  it('stops recursion at max depth', async () => {
    // Chain of distinct sitemaps a → b → c → d; depth 3 must be refused
    vi.mocked(fetchUrlRaw).mockImplementation(async (url: string) => {
      const next = { a: 'b', b: 'c', c: 'd', d: 'e' }[url.match(/sitemap-(\w)/)![1]]
      return `<sitemapindex><sitemap><loc>https://example.com/sitemap-${next}.xml</loc></sitemap></sitemapindex>`
    })

    const urls = await fetchSitemapPagesViaJina('https://example.com/sitemap-a.xml', 0, 0)
    expect(urls).toEqual([])
    // depth 0 (a), 1 (b), 2 (c) fetched; d at depth 3 refused
    expect(vi.mocked(fetchUrlRaw)).toHaveBeenCalledTimes(3)
  })

  it('🔴 reports the depth-limit cut-off — truncation looks like an empty subtree', async () => {
    vi.mocked(fetchUrlRaw).mockImplementation(async (url: string) => {
      const next = { a: 'b', b: 'c', c: 'd', d: 'e' }[url.match(/sitemap-(\w)/)![1]]
      return `<sitemapindex><sitemap><loc>https://example.com/sitemap-${next}.xml</loc></sitemap></sitemapindex>`
    })
    const issues: DiscoveryIssue[] = []

    await fetchSitemapPagesViaJina('https://example.com/sitemap-a.xml', 0, 0, new Set(), (stage, error, url) =>
      issues.push({ stage, error: String(error), url }),
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      stage: 'jina-sitemap-depth-limit',
      url: 'https://example.com/sitemap-d.xml',
    })
  })

  it('reports a child sitemap that throws', async () => {
    vi.mocked(fetchUrlRaw).mockImplementation(async (url: string) => {
      if (url === 'https://example.com/sitemap.xml') return SITEMAP_INDEX_XML
      if (url === 'https://example.com/sitemap-pages.xml') return SITEMAP_PAGES_XML
      throw new Error('Timeout')
    })
    const issues: DiscoveryIssue[] = []

    await fetchSitemapPagesViaJina('https://example.com/sitemap.xml', 0, 0, new Set(), (stage, error, url) =>
      issues.push({ stage, error: String(error), url }),
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      stage: 'jina-child-sitemap',
      url: 'https://example.com/sitemap-posts.xml',
    })
  })
})
