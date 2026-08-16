/**
 * Site Auditor Crawler — the same-host rule used by every discovery path
 * (sitemap <loc> filtering, homepage BFS, Jina markdown links).
 *
 * 🔴 Codex review on PR #963 (P2): `https://example.com./page` is the absolute
 *    (root-anchored) DNS form of `https://example.com/page`, and WHATWG URL
 *    keeps the trailing dot in `hostname`. The exact-hostname comparison that
 *    replaced the old string-prefix test therefore rejected every such page —
 *    a silent inventory loss on any site whose sitemap uses rooted names.
 *
 *    Exactly ONE trailing root dot is removed. That is what makes the fix safe:
 *    the hostile shapes the exact comparison exists to reject
 *    (`example.com.evil.test`, `example.com..evil.test`) have no trailing dot
 *    to strip, so they are unaffected. The prefix comparison is NOT restored.
 *
 * Unit assertions go through `extractSameDomainLinks()`; the integration ones
 * drive the real `discoverSitemapUrls()` so the sitemap <loc> filter is covered
 * too. No network: transport and DNS are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { discoverSitemapUrls, extractSameDomainLinks } from '../crawler'
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

const urlset = (locs: string[]): string =>
  `<urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`

describe('same-host comparison — trailing DNS root dot', () => {
  it('accepts a rooted candidate against an unrooted origin', () => {
    const html = '<a href="https://example.com./a">a</a>'
    expect(extractSameDomainLinks(html, 'https://example.com')).toEqual(['https://example.com./a'])
  })

  it('accepts an unrooted candidate against a rooted origin', () => {
    const html = '<a href="https://example.com/a">a</a>'
    expect(extractSameDomainLinks(html, 'https://example.com.')).toEqual(['https://example.com/a'])
  })

  it('treats rooted and unrooted as equivalent in both directions and in combination with www.', () => {
    const rootedHtml = '<a href="https://www.example.com./a">a</a>'
    const bareHtml = '<a href="https://example.com/a">a</a>'
    const wwwHtml = '<a href="https://www.example.com/a">a</a>'

    // www. + root dot, against every spelling of the origin
    for (const origin of [
      'https://example.com',
      'https://example.com.',
      'https://www.example.com',
      'https://www.example.com.',
    ]) {
      expect(extractSameDomainLinks(rootedHtml, origin), origin).toHaveLength(1)
      expect(extractSameDomainLinks(bareHtml, origin), origin).toHaveLength(1)
      expect(extractSameDomainLinks(wwwHtml, origin), origin).toHaveLength(1)
    }
  })

  it('is case-insensitive about the hostname, rooted or not', () => {
    const html = '<a href="https://EXAMPLE.COM./a">a</a>'
    expect(extractSameDomainLinks(html, 'https://example.com')).toHaveLength(1)
  })

  it('still rejects a suffix-attack hostname, with or without extra dots', () => {
    const html = `<a href="https://example.com.evil.test/x">1</a>
      <a href="https://example.com..evil.test/x">2</a>
      <a href="https://example.com.evil.test./x">3</a>
      <a href="https://notexample.com/x">4</a>`
    expect(extractSameDomainLinks(html, 'https://example.com')).toEqual([])
  })

  it('removes only ONE root dot, so a doubled trailing dot is a different host', () => {
    // `example.com..` is not a legal rooted name; stripping one dot leaves
    // `example.com.`, which is still not `example.com`.
    const html = '<a href="https://example.com../a">a</a>'
    expect(extractSameDomainLinks(html, 'https://example.com')).toEqual([])
  })
})

describe('discoverSitemapUrls — rooted hostnames in sitemap <loc> entries', () => {
  beforeEach(() => {
    vi.mocked(fetchUrlRaw).mockReset().mockRejectedValue(new Error('jina unavailable'))
    vi.mocked(fetchUrlAsMarkdown).mockReset().mockRejectedValue(new Error('jina unavailable'))
    dnsLookupMock.mockReset().mockResolvedValue(PUBLIC_DNS_ANSWER)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function serve(routes: Record<string, string>): ReturnType<typeof vi.fn> {
    return vi.fn(async (url: unknown) => {
      const body = routes[String(url)]
      return body === undefined ? mockNotFound() : mockResponse(body)
    })
  }

  it('keeps pages whose <loc> uses the rooted form of the audited domain', async () => {
    vi.stubGlobal('fetch', serve({
      'https://example.com/robots.txt': ROBOTS_TXT_EMPTY,
      'https://example.com/sitemap.xml': urlset([
        'https://example.com./page-1',
        'https://example.com./page-2',
      ]),
    }))

    const urls = await discoverSitemapUrls('example.com')

    expect(urls).toEqual(['https://example.com./page-1', 'https://example.com./page-2'])
  })

  it('keeps unrooted pages when the audited domain itself was given rooted', async () => {
    vi.stubGlobal('fetch', serve({
      'https://example.com./robots.txt': ROBOTS_TXT_EMPTY,
      'https://example.com./sitemap.xml': urlset([
        'https://example.com/page-1',
        'https://www.example.com/page-2',
      ]),
    }))

    const urls = await discoverSitemapUrls('example.com.')

    expect(urls).toEqual(['https://example.com/page-1', 'https://www.example.com/page-2'])
  })

  it('still filters out a suffix-attack host that only looks rooted', async () => {
    vi.stubGlobal('fetch', serve({
      'https://example.com/robots.txt': ROBOTS_TXT_EMPTY,
      'https://example.com/sitemap.xml': urlset([
        'https://example.com./real-1',
        'https://example.com./real-2',
        'https://example.com.evil.test/fake',
        'https://example.com..evil.test/fake',
      ]),
    }))

    const urls = await discoverSitemapUrls('example.com')

    expect(urls).toEqual(['https://example.com./real-1', 'https://example.com./real-2'])
  })
})
