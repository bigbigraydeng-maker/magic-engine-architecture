/**
 * Site Auditor Crawler — SSRF guard on child-sitemap fetches, and exact-host
 * comparison (Codex review on PR #963).
 *
 * A sitemap's <loc> entries are attacker-controlled — the audited site's
 * owner (or whoever compromised it) writes the sitemap content. Before this
 * fix, discoverSitemapUrls()'s Level 1 expansion and Level 2 (/sitemap_index.xml)
 * fetched every child <loc> directly with fetch()'s default automatic
 * redirect-following and no host validation at all: same-origin filtering
 * (dedupeAndFilter) only trims the *returned* list, it can't recall a request
 * that already went out. A malicious sitemap could point the crawler at
 * 127.0.0.1, cloud metadata, or any internal address and Render's own
 * network would make that request.
 *
 * These tests never touch the real network — fetch and DNS (node:dns/promises)
 * are both mocked. See crawler-test-files.ts for the fixed manifest this file
 * is registered in.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { lookup } from 'node:dns/promises'
import { discoverSitemapUrls, type DiscoveryIssue } from '../crawler'
import { fetchUrlRaw, fetchUrlAsMarkdown } from '../../brief/jina'
import { ROBOTS_TXT_EMPTY, mockResponse, mockNotFound } from './crawler-fixtures'

vi.mock('../../brief/jina', () => ({
  fetchUrlAsMarkdown: vi.fn(),
  fetchUrlRaw: vi.fn(),
}))

vi.mock('node:dns/promises', () => {
  const lookup = vi.fn()
  return { lookup, default: { lookup } }
})

const PUBLIC_IP = '93.184.216.34' // example.com's real public IP (RFC 2606) — stand-in value only

function mockRedirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } })
}

describe('discoverSitemapUrls — SSRF guard on child sitemap fetches (Codex review on PR #963)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.mocked(fetchUrlRaw).mockReset().mockRejectedValue(new Error('jina unavailable'))
    vi.mocked(fetchUrlAsMarkdown).mockReset().mockRejectedValue(new Error('jina unavailable'))
    // Default: every hostname resolves to a public IP — tests override this
    // per-case to simulate a private/loopback resolution. No real network access.
    vi.mocked(lookup).mockReset().mockResolvedValue({ address: PUBLIC_IP, family: 4 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('blocks a child sitemap at a literal IPv4 loopback address (127.0.0.1)', async () => {
    const index = '<sitemapindex><sitemap><loc>http://127.0.0.1/admin-sitemap.xml</loc></sitemap></sitemapindex>'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
      .mockResolvedValueOnce(mockResponse(index))
      .mockResolvedValue(mockNotFound())
    vi.stubGlobal('fetch', fetchMock)
    const issues: DiscoveryIssue[] = []

    const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

    expect(urls).toEqual([])
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('127.0.0.1'))).toBe(false)
    expect(issues).toContainEqual(
      expect.objectContaining({ stage: 'sitemap-blocked-host', url: expect.stringContaining('127.0.0.1') })
    )
  })

  it('blocks a child sitemap whose hostname resolves to loopback (localhost)', async () => {
    vi.mocked(lookup).mockImplementation(async (hostname) =>
      hostname === 'localhost' ? { address: '127.0.0.1', family: 4 } : { address: PUBLIC_IP, family: 4 }
    )
    const index = '<sitemapindex><sitemap><loc>http://localhost/admin-sitemap.xml</loc></sitemap></sitemapindex>'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
      .mockResolvedValueOnce(mockResponse(index))
      .mockResolvedValue(mockNotFound())
    vi.stubGlobal('fetch', fetchMock)
    const issues: DiscoveryIssue[] = []

    const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

    expect(urls).toEqual([])
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('localhost'))).toBe(false)
    expect(issues).toContainEqual(
      expect.objectContaining({ stage: 'sitemap-blocked-host', url: expect.stringContaining('localhost') })
    )
  })

  it('blocks a child sitemap at the cloud metadata address (169.254.169.254)', async () => {
    const index = '<sitemapindex><sitemap><loc>http://169.254.169.254/latest/meta-data/</loc></sitemap></sitemapindex>'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
      .mockResolvedValueOnce(mockResponse(index))
      .mockResolvedValue(mockNotFound())
    vi.stubGlobal('fetch', fetchMock)
    const issues: DiscoveryIssue[] = []

    const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

    expect(urls).toEqual([])
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('169.254.169.254'))).toBe(false)
    expect(issues).toContainEqual(
      expect.objectContaining({ stage: 'sitemap-blocked-host', url: expect.stringContaining('169.254.169.254') })
    )
  })

  it('blocks child sitemaps at RFC1918 private IPv4 addresses (10.x / 172.16-31.x / 192.168.x)', async () => {
    const index = `<sitemapindex>
  <sitemap><loc>http://10.1.2.3/a.xml</loc></sitemap>
  <sitemap><loc>http://172.20.0.5/b.xml</loc></sitemap>
  <sitemap><loc>http://192.168.50.1/c.xml</loc></sitemap>
</sitemapindex>`
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
      .mockResolvedValueOnce(mockResponse(index))
      .mockResolvedValue(mockNotFound())
    vi.stubGlobal('fetch', fetchMock)
    const issues: DiscoveryIssue[] = []

    const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

    expect(urls).toEqual([])
    const requested = fetchMock.mock.calls.map(([u]) => String(u))
    expect(requested.some((u) => u.includes('10.1.2.3'))).toBe(false)
    expect(requested.some((u) => u.includes('172.20.0.5'))).toBe(false)
    expect(requested.some((u) => u.includes('192.168.50.1'))).toBe(false)
    const blockedUrls = issues.filter((i) => i.stage === 'sitemap-blocked-host').map((i) => i.url)
    expect(blockedUrls).toEqual(
      expect.arrayContaining([
        expect.stringContaining('10.1.2.3'),
        expect.stringContaining('172.20.0.5'),
        expect.stringContaining('192.168.50.1'),
      ])
    )
  })

  it('blocks child sitemaps at IPv6 loopback / private / link-local addresses', async () => {
    const index = `<sitemapindex>
  <sitemap><loc>http://[::1]/a.xml</loc></sitemap>
  <sitemap><loc>http://[fd12::1]/b.xml</loc></sitemap>
  <sitemap><loc>http://[fe80::1]/c.xml</loc></sitemap>
</sitemapindex>`
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
      .mockResolvedValueOnce(mockResponse(index))
      .mockResolvedValue(mockNotFound())
    vi.stubGlobal('fetch', fetchMock)
    const issues: DiscoveryIssue[] = []

    const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

    expect(urls).toEqual([])
    const requested = fetchMock.mock.calls.map(([u]) => String(u))
    expect(requested.some((u) => u.includes('::1'))).toBe(false)
    expect(requested.some((u) => u.includes('fd12::1'))).toBe(false)
    expect(requested.some((u) => u.includes('fe80::1'))).toBe(false)
    const blockedStages = issues.filter((i) => i.stage === 'sitemap-blocked-host')
    expect(blockedStages.length).toBe(3)
  })

  it('blocks a public-looking domain whose DNS resolves to a private IP', async () => {
    vi.mocked(lookup).mockImplementation(async (hostname) =>
      hostname === 'internal-redirector.example' ? { address: '10.8.8.8', family: 4 } : { address: PUBLIC_IP, family: 4 }
    )
    const index = '<sitemapindex><sitemap><loc>https://internal-redirector.example/sitemap.xml</loc></sitemap></sitemapindex>'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
      .mockResolvedValueOnce(mockResponse(index))
      .mockResolvedValue(mockNotFound())
    vi.stubGlobal('fetch', fetchMock)
    const issues: DiscoveryIssue[] = []

    const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

    expect(urls).toEqual([])
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('internal-redirector.example'))).toBe(false)
    expect(issues).toContainEqual(
      expect.objectContaining({ stage: 'sitemap-blocked-host', url: expect.stringContaining('internal-redirector.example') })
    )
  })

  it('blocks a public redirect that lands on a private address, without ever fetching it', async () => {
    const index = '<sitemapindex><sitemap><loc>https://example.com/sitemap-region.xml</loc></sitemap></sitemapindex>'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
      .mockResolvedValueOnce(mockResponse(index))
      .mockResolvedValueOnce(mockRedirect('http://127.0.0.1/secret-sitemap.xml')) // sitemap-region.xml → 302
      .mockResolvedValue(mockNotFound())
    vi.stubGlobal('fetch', fetchMock)
    const issues: DiscoveryIssue[] = []

    const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

    expect(urls).toEqual([])
    // The redirect's public starting URL WAS requested; its private target never was.
    expect(fetchMock.mock.calls.some(([u]) => String(u) === 'https://example.com/sitemap-region.xml')).toBe(true)
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('127.0.0.1'))).toBe(false)
    expect(issues).toContainEqual(
      expect.objectContaining({ stage: 'sitemap-blocked-host', url: expect.stringContaining('127.0.0.1') })
    )
  })

  it('reports a genuine DNS failure distinctly from a blocked address', async () => {
    vi.mocked(lookup).mockImplementation(async (hostname) => {
      if (hostname === 'broken-dns.example') throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })
      return { address: PUBLIC_IP, family: 4 }
    })
    const index = '<sitemapindex><sitemap><loc>https://broken-dns.example/sitemap.xml</loc></sitemap></sitemapindex>'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
      .mockResolvedValueOnce(mockResponse(index))
      .mockResolvedValue(mockNotFound())
    vi.stubGlobal('fetch', fetchMock)
    const issues: DiscoveryIssue[] = []

    await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

    expect(issues.some((i) => i.stage === 'sitemap-blocked-host')).toBe(false)
    expect(issues).toContainEqual(
      expect.objectContaining({ stage: 'sitemap-fetch', url: expect.stringContaining('broken-dns.example') })
    )
  })

  it('caps sitemap redirect hops and reports when the cap is exceeded', async () => {
    const chain = [0, 1, 2, 3, 4].map((n) => `https://example.com/redirect-${n}.xml`)
    const index = `<sitemapindex><sitemap><loc>${chain[0]}</loc></sitemap></sitemapindex>`
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
      .mockResolvedValueOnce(mockResponse(index))
      .mockResolvedValueOnce(mockRedirect(chain[1])) // redirect-0 → redirect-1
      .mockResolvedValueOnce(mockRedirect(chain[2])) // redirect-1 → redirect-2
      .mockResolvedValueOnce(mockRedirect(chain[3])) // redirect-2 → redirect-3
      .mockResolvedValueOnce(mockRedirect(chain[4])) // redirect-3 → redirect-4 (exceeds the cap)
      .mockResolvedValue(mockNotFound())
    vi.stubGlobal('fetch', fetchMock)
    const issues: DiscoveryIssue[] = []

    const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

    expect(urls).toEqual([])
    // redirect-4.xml is one hop past the cap — it must never actually be requested.
    expect(fetchMock.mock.calls.some(([u]) => String(u) === chain[4])).toBe(false)
    expect(issues).toContainEqual(
      expect.objectContaining({ stage: 'sitemap-too-many-redirects', url: chain[0] })
    )
  })

  it('still fetches and returns a legitimate same-host child sitemap (no false positive)', async () => {
    const index = '<sitemapindex><sitemap><loc>https://example.com/sitemap-posts.xml</loc></sitemap></sitemapindex>'
    const posts = '<urlset><url><loc>https://example.com/post-1</loc></url><url><loc>https://example.com/post-2</loc></url></urlset>'
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
      .mockResolvedValueOnce(mockResponse(index))
      .mockResolvedValueOnce(mockResponse(posts))
    )

    const urls = await discoverSitemapUrls('example.com')

    expect(urls).toEqual(['https://example.com/post-1', 'https://example.com/post-2'])
  })

  it('returns the legitimate sibling after a malicious sibling is rejected', async () => {
    const index = `<sitemapindex>
  <sitemap><loc>http://127.0.0.1/admin-sitemap.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
</sitemapindex>`
    const pages = '<urlset><url><loc>https://example.com/about</loc></url><url><loc>https://example.com/contact</loc></url></urlset>'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
      .mockResolvedValueOnce(mockResponse(index))
      .mockResolvedValueOnce(mockResponse(pages)) // only the legit sibling is ever actually fetched
    vi.stubGlobal('fetch', fetchMock)
    const issues: DiscoveryIssue[] = []

    const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

    expect(urls).toEqual(['https://example.com/about', 'https://example.com/contact'])
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('127.0.0.1'))).toBe(false)
    expect(issues).toContainEqual(expect.objectContaining({ stage: 'sitemap-blocked-host' }))
  })

  it('blocks a malicious child reached via /sitemap_index.xml (Level 2), while returning the legitimate sibling', async () => {
    const index = `<sitemapindex>
  <sitemap><loc>http://169.254.169.254/latest/meta-data/</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
</sitemapindex>`
    const pages = '<urlset><url><loc>https://example.com/about</loc></url><url><loc>https://example.com/contact</loc></url></urlset>'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))          // robots.txt
      .mockResolvedValueOnce(mockNotFound())                          // sitemap.xml 404 → falls to Level 2
      .mockResolvedValueOnce(mockResponse(index))                     // sitemap_index.xml
      .mockResolvedValueOnce(mockResponse(pages))                     // legit child — the metadata child is never fetched
    vi.stubGlobal('fetch', fetchMock)
    const issues: DiscoveryIssue[] = []

    const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

    expect(urls).toEqual(['https://example.com/about', 'https://example.com/contact'])
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('169.254.169.254'))).toBe(false)
    expect(issues).toContainEqual(
      expect.objectContaining({ stage: 'sitemap-blocked-host', url: expect.stringContaining('169.254.169.254') })
    )
  })
})

describe('discoverSitemapUrls — exact host comparison, not string-prefix (Codex review on PR #963)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.mocked(fetchUrlRaw).mockReset().mockRejectedValue(new Error('jina unavailable'))
    vi.mocked(fetchUrlAsMarkdown).mockReset().mockRejectedValue(new Error('jina unavailable'))
    vi.mocked(lookup).mockReset().mockResolvedValue({ address: PUBLIC_IP, family: 4 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not treat example.com.evil.test as belonging to example.com (exact hostname match)', async () => {
    const urlset = `<urlset>
  <url><loc>https://example.com/real-page</loc></url>
  <url><loc>https://example.com.evil.test/fake-page</loc></url>
</urlset>`
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
      .mockResolvedValueOnce(mockResponse(urlset))
      .mockResolvedValue(mockNotFound()) // only 1 same-host URL — below MIN_DISCOVERED_URLS, so
    )                                    // discovery escalates through the remaining levels

    const urls = await discoverSitemapUrls('example.com')

    expect(urls).toEqual(['https://example.com/real-page'])
  })
})
