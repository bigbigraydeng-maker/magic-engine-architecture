/**
 * Site Auditor Crawler — discoverSitemapUrls() integration tests (fetch mocked).
 *
 * Split out of crawler.test.ts (Codex review on PR #963, P1 — the combined
 * file exceeded the repo's 800-line-per-file cap). Covers the five-level
 * discovery fallback: robots.txt directive, /sitemap.xml (incl. sitemap-index
 * detection, Issue #955), /sitemap_index.xml, homepage BFS, and Jina escalation.
 * See crawler-test-files.ts for the fixed manifest of all split files.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  discoverSitemapUrls,
  MIN_DISCOVERED_URLS,
  MAX_BFS_LINKS,
  type DiscoveryIssue,
} from '../crawler'
import { fetchUrlRaw, fetchUrlAsMarkdown } from '../../brief/jina'
import {
  SITEMAP_XML_10_URLS,
  SITEMAP_INDEX_XML,
  SITEMAP_POSTS_XML,
  SITEMAP_PAGES_XML,
  ROBOTS_TXT_WITH_SITEMAP,
  CUSTOM_SITEMAP_XML,
  ROBOTS_TXT_BLOCKING_ALL,
  ROBOTS_TXT_EMPTY,
  HOMEPAGE_HTML_WITH_LINKS,
  mockResponse,
  mockNotFound,
} from './crawler-fixtures'

// The crawler imports jina dynamically; mock it module-wide so discovery tests
// control the Jina escalation path.
vi.mock('../../brief/jina', () => ({
  fetchUrlAsMarkdown: vi.fn(),
  fetchUrlRaw: vi.fn(),
}))

describe('discoverSitemapUrls', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    // Default: Jina unavailable — direct-fetch tests exercise levels 0-4 only
    vi.mocked(fetchUrlRaw).mockReset().mockRejectedValue(new Error('jina unavailable'))
    vi.mocked(fetchUrlAsMarkdown).mockReset().mockRejectedValue(new Error('jina unavailable'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('domain input normalisation', () => {
    it('accepts bare domain without scheme', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))          // robots.txt
        .mockResolvedValueOnce(mockResponse(SITEMAP_XML_10_URLS))       // sitemap.xml

      vi.stubGlobal('fetch', fetchMock)

      const urls = await discoverSitemapUrls('example.com')
      expect(urls.length).toBeGreaterThan(0)
      // Verify fetch was called with https://
      expect(fetchMock.mock.calls[0][0]).toMatch(/^https:\/\/example\.com/)
    })

    it('accepts full https:// URL and normalises it', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockResponse(SITEMAP_XML_10_URLS))

      vi.stubGlobal('fetch', fetchMock)

      const urls = await discoverSitemapUrls('https://example.com')
      expect(urls.length).toBeGreaterThan(0)
    })
  })

  describe('happy path — sitemap.xml found', () => {
    it('returns 10 URLs from sitemap.xml', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))        // robots.txt
        .mockResolvedValueOnce(mockResponse(SITEMAP_XML_10_URLS))     // sitemap.xml
      )

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(10)
      expect(urls[0]).toBe('https://example.com/page-1')
    })

    it('returns only same-domain URLs (filters cross-domain locs)', async () => {
      const mixedSitemap = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://example.com/local</loc></url>
  <url><loc>https://other.com/external</loc></url>
</urlset>`

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockResponse(mixedSitemap))
      )

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(1)
      expect(urls[0]).toBe('https://example.com/local')
    })

    it('de-duplicates URLs returned by sitemap', async () => {
      const dupeSitemap = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://example.com/page</loc></url>
  <url><loc>https://example.com/page</loc></url>
</urlset>`

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockResponse(dupeSitemap))
      )

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(1)
    })

    it('accepts sitemap URLs with www. prefix when domain has no www. (real-world case)', async () => {
      // Many sites redirect domain.com → www.domain.com and their sitemaps use www URLs
      // e.g. ctstours.co.nz sitemap contains https://www.ctstours.co.nz/* URLs
      const wwwSitemap = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://www.example.com/</loc></url>
  <url><loc>https://www.example.com/page-1</loc></url>
  <url><loc>https://www.example.com/page-2</loc></url>
  <url><loc>https://other.com/external</loc></url>
</urlset>`

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockResponse(wwwSitemap))
      )

      // Domain passed without www — but sitemap uses www
      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(3)  // 3 www URLs, 1 external filtered out
      expect(urls[0]).toBe('https://www.example.com/')
    })

    it('accepts sitemap URLs without www. when domain has www.', async () => {
      const noWwwSitemap = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://example.com/page-a</loc></url>
  <url><loc>https://example.com/page-b</loc></url>
</urlset>`

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockResponse(noWwwSitemap))
      )

      const urls = await discoverSitemapUrls('www.example.com')
      expect(urls).toHaveLength(2)
    })
  })

  /**
   * Issue #955 — Level 1 (/sitemap.xml) must detect <sitemapindex> from the
   * XML response structure and recursively expand it via fetchSitemapPageUrls(),
   * instead of returning the index's own <loc> entries (child sitemap URLs) as
   * if they were pages, and instead of guessing "is this a sitemap" from a
   * `.xml` suffix (real sites use extension-less and query-string child sitemaps).
   */
  describe('Level 1 — /sitemap.xml is itself a sitemap index (Issue #955)', () => {
    it('🔴 recurses into child sitemaps instead of returning index <loc> entries as pages', async () => {
      // Naive parseLocsFromXml(xml) on SITEMAP_INDEX_XML yields exactly 2 <loc>
      // entries — both child *sitemap* URLs. That happens to be >= MIN_DISCOVERED_URLS,
      // so the old bug (no structure check) would return those 2 sitemap documents
      // as the final "page" candidates and never fetch the children below.
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))       // robots.txt
        .mockResolvedValueOnce(mockResponse(SITEMAP_INDEX_XML))      // sitemap.xml (is an index)
        .mockResolvedValueOnce(mockResponse(SITEMAP_POSTS_XML))      // sitemap-posts.xml (3 pages)
        .mockResolvedValueOnce(mockResponse(SITEMAP_PAGES_XML))      // sitemap-pages.xml (3 pages)
      )

      const urls = await discoverSitemapUrls('example.com')

      expect(urls).toHaveLength(6)
      expect(urls).toContain('https://example.com/post-1')
      expect(urls).toContain('https://example.com/about')
      // The sitemap documents themselves must never be returned as page candidates.
      expect(urls.some((u) => u.endsWith('.xml'))).toBe(false)
    })

    it('recurses through a multi-level nested sitemap index', async () => {
      const topIndex = `<?xml version="1.0"?>
<sitemapindex><sitemap><loc>https://example.com/sitemap-region.xml</loc></sitemap></sitemapindex>`
      const regionIndex = `<?xml version="1.0"?>
<sitemapindex><sitemap><loc>https://example.com/sitemap-region-posts.xml</loc></sitemap></sitemapindex>`
      const regionPosts = `<?xml version="1.0"?>
<urlset><url><loc>https://example.com/region/post-1</loc></url><url><loc>https://example.com/region/post-2</loc></url></urlset>`

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockResponse(topIndex))          // sitemap.xml → index
        .mockResolvedValueOnce(mockResponse(regionIndex))       // sitemap-region.xml → still an index
        .mockResolvedValueOnce(mockResponse(regionPosts))       // sitemap-region-posts.xml → real pages
      )

      const urls = await discoverSitemapUrls('example.com')

      expect(urls).toEqual([
        'https://example.com/region/post-1',
        'https://example.com/region/post-2',
      ])
    })

    it('follows an extension-less child sitemap URL (e.g. /sitemap/posts)', async () => {
      const indexWithNoExtChild = `<?xml version="1.0"?>
<sitemapindex><sitemap><loc>https://example.com/sitemap/posts</loc></sitemap></sitemapindex>`
      const postsUrlset = `<?xml version="1.0"?>
<urlset><url><loc>https://example.com/blog/post-1</loc></url><url><loc>https://example.com/blog/post-2</loc></url></urlset>`

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockResponse(indexWithNoExtChild))  // sitemap.xml → index, child has no extension
        .mockResolvedValueOnce(mockResponse(postsUrlset))          // /sitemap/posts → real pages
      )

      const urls = await discoverSitemapUrls('example.com')

      expect(urls).toEqual(['https://example.com/blog/post-1', 'https://example.com/blog/post-2'])
    })

    it('follows a query-string child sitemap URL (e.g. /sitemap.php?type=post)', async () => {
      const indexWithQueryChild = `<?xml version="1.0"?>
<sitemapindex><sitemap><loc>https://example.com/sitemap.php?type=post</loc></sitemap></sitemapindex>`
      const postsUrlset = `<?xml version="1.0"?>
<urlset><url><loc>https://example.com/news/post-1</loc></url><url><loc>https://example.com/news/post-2</loc></url></urlset>`

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockResponse(indexWithQueryChild))  // sitemap.xml → index, child has query string
        .mockResolvedValueOnce(mockResponse(postsUrlset))          // sitemap.php?type=post → real pages
      )

      const urls = await discoverSitemapUrls('example.com')

      expect(urls).toEqual(['https://example.com/news/post-1', 'https://example.com/news/post-2'])
    })

    it('filters out-of-host child sitemap results while keeping same-host pages', async () => {
      const indexWithForeignChild = `<?xml version="1.0"?>
<sitemapindex>
  <sitemap><loc>https://example.com/sitemap-local.xml</loc></sitemap>
  <sitemap><loc>https://cdn.example.net/sitemap-foreign.xml</loc></sitemap>
</sitemapindex>`
      const localUrlset = `<?xml version="1.0"?>
<urlset><url><loc>https://example.com/local-1</loc></url></urlset>`
      const foreignUrlset = `<?xml version="1.0"?>
<urlset><url><loc>https://cdn.example.net/foreign-1</loc></url></urlset>`

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockResponse(indexWithForeignChild))
        .mockResolvedValueOnce(mockResponse(localUrlset))
        .mockResolvedValueOnce(mockResponse(foreignUrlset))
        .mockResolvedValue(mockNotFound())                          // remaining levels (2/4) 404 out
      )

      const urls = await discoverSitemapUrls('example.com')

      // Only 1 same-host page — foreign-host page is filtered, so total is
      // below MIN_DISCOVERED_URLS and discovery escalates past this level;
      // fetch is exhausted (Jina rejects by default), so the best partial
      // result — the one local page — is what's ultimately returned.
      expect(urls).toEqual(['https://example.com/local-1'])
    })

    it('reports a child sitemap fetch failure but still returns the sibling pages', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockResponse(SITEMAP_INDEX_XML))   // sitemap.xml → index (2 children)
        .mockRejectedValueOnce(new Error('Timeout'))              // sitemap-posts.xml throws
        .mockResolvedValueOnce(mockResponse(SITEMAP_PAGES_XML))   // sitemap-pages.xml ok
      )
      const issues: DiscoveryIssue[] = []

      const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

      expect(urls).toEqual(['https://example.com/about', 'https://example.com/contact', 'https://example.com/services'])
      expect(issues).toContainEqual(
        expect.objectContaining({ stage: 'sitemap-fetch', url: 'https://example.com/sitemap-posts.xml' })
      )
    })

    it('bounds a self-referencing sitemap index at MAX_SITEMAP_DEPTH instead of looping forever', async () => {
      const selfIndexXml =
        '<sitemapindex><sitemap><loc>https://example.com/sitemap.xml</loc></sitemap></sitemapindex>'

      const fetchMock = vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))     // robots.txt
        .mockResolvedValueOnce(mockResponse(selfIndexXml))         // sitemap.xml — depth 0 (Level 1's own fetch)
        .mockResolvedValueOnce(mockResponse(selfIndexXml))         // recursion depth 1
        .mockResolvedValueOnce(mockResponse(selfIndexXml))         // recursion depth 2
        .mockResolvedValue(mockNotFound())                         // depth-limit stops before a 4th fetch; remaining levels 404
      vi.stubGlobal('fetch', fetchMock)

      const issues: DiscoveryIssue[] = []
      const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

      expect(urls).toEqual([])
      expect(issues).toContainEqual(
        expect.objectContaining({ stage: 'sitemap-depth-limit', url: 'https://example.com/sitemap.xml' })
      )
      // Exactly 3 fetches of the self-referencing URL (depth 0, 1, 2) — the 4th
      // (depth 3) is refused before ever calling fetch, proving termination.
      const selfFetches = fetchMock.mock.calls.filter(([u]) => u === 'https://example.com/sitemap.xml').length
      expect(selfFetches).toBe(3)
    })

    it('stays silent when a sitemap index resolves cleanly (no swallowed failures)', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockResponse(SITEMAP_INDEX_XML))
        .mockResolvedValueOnce(mockResponse(SITEMAP_POSTS_XML))
        .mockResolvedValueOnce(mockResponse(SITEMAP_PAGES_XML))
      )
      const issues: DiscoveryIssue[] = []

      const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

      expect(urls).toHaveLength(6)
      expect(issues).toEqual([])
    })

    it('a plain 404 on /sitemap.xml itself stays silent, same as before this fix', async () => {
      // Guards the pre-existing "normal fallback, not a swallowed failure"
      // semantics: Level 1's own fetch failing must not emit an issue — only
      // failures while expanding a *confirmed* index should be reported.
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockNotFound())                    // sitemap.xml 404
        .mockResolvedValueOnce(mockResponse(SITEMAP_INDEX_XML))   // sitemap_index.xml
        .mockResolvedValueOnce(mockResponse(SITEMAP_POSTS_XML))
        .mockResolvedValueOnce(mockResponse(SITEMAP_PAGES_XML))
      )
      const issues: DiscoveryIssue[] = []

      const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

      expect(urls).toHaveLength(6)
      expect(issues).toEqual([])
    })
  })

  /**
   * Codex review on PR #963 (P2): parseLocsFromXml() must decode XML entities
   * so a &amp;-escaped multi-param query string is fetched/returned correctly,
   * not with the literal "amp;" text still embedded in the URL.
   */
  describe('XML entity decoding when discovering pages (Codex review P2)', () => {
    it('requests the decoded URL for a &amp;-escaped child sitemap, not the literal amp;', async () => {
      const indexWithEscapedChild = `<?xml version="1.0"?>
<sitemapindex><sitemap><loc>https://example.com/sitemap.php?type=post&amp;page=2</loc></sitemap></sitemapindex>`
      const childUrlset = `<?xml version="1.0"?>
<urlset><url><loc>https://example.com/blog/post-1</loc></url><url><loc>https://example.com/blog/post-2</loc></url></urlset>`

      const fetchMock = vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockResponse(indexWithEscapedChild))  // sitemap.xml → index, child has &amp;
        .mockResolvedValueOnce(mockResponse(childUrlset))
      vi.stubGlobal('fetch', fetchMock)

      const urls = await discoverSitemapUrls('example.com')

      expect(urls).toEqual(['https://example.com/blog/post-1', 'https://example.com/blog/post-2'])
      // The child sitemap must be requested with a decoded query string.
      const requestedUrls = fetchMock.mock.calls.map(([u]) => u)
      expect(requestedUrls).toContain('https://example.com/sitemap.php?type=post&page=2')
      expect(requestedUrls.some((u) => u.includes('amp;'))).toBe(false)
    })

    it('returns a &amp;-escaped page <loc> as a decoded page candidate, not the literal amp;', async () => {
      const urlsetWithEscapedLoc = `<?xml version="1.0"?>
<urlset><url><loc>https://example.com/search?a=1&amp;b=2</loc></url></urlset>`

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockResponse(urlsetWithEscapedLoc))
      )

      const urls = await discoverSitemapUrls('example.com')

      expect(urls).toEqual(['https://example.com/search?a=1&b=2'])
      expect(urls.some((u) => u.includes('amp;'))).toBe(false)
    })
  })

  describe('fallback 1 — sitemap.xml 404, sitemap_index.xml resolves', () => {
    it('fetches child sitemaps and returns 6 URLs total', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))         // robots.txt
        .mockResolvedValueOnce(mockNotFound())                         // sitemap.xml 404
        .mockResolvedValueOnce(mockResponse(SITEMAP_INDEX_XML))        // sitemap_index.xml
        .mockResolvedValueOnce(mockResponse(SITEMAP_POSTS_XML))        // sitemap-posts.xml (3 URLs)
        .mockResolvedValueOnce(mockResponse(SITEMAP_PAGES_XML))        // sitemap-pages.xml (3 URLs)
      )

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(6)
      expect(urls).toContain('https://example.com/post-1')
      expect(urls).toContain('https://example.com/about')
    })

    it('skips unreachable child sitemaps and returns remaining URLs (covers L216 catch)', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))         // robots.txt
        .mockResolvedValueOnce(mockNotFound())                         // sitemap.xml 404
        .mockResolvedValueOnce(mockResponse(SITEMAP_INDEX_XML))        // sitemap_index.xml (2 children)
        .mockRejectedValueOnce(new Error('Timeout'))                   // sitemap-posts.xml throws
        .mockResolvedValueOnce(mockResponse(SITEMAP_PAGES_XML))        // sitemap-pages.xml succeeds (3 URLs)
      )

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(3)
      expect(urls).toContain('https://example.com/about')
    })
  })

  /**
   * onIssue — 部分结果必须跟完整结果分得开（Issue #930）。
   *
   * 🔴 这些断言盯的是 discoverSitemapUrls 的**沉默**，不是它的返回值：
   *    每一级回退都会吞掉失败继续走，返回的数组跟完整发现长得一模一样 ——
   *    promise 正常 resolve、条数为正、没有任何异常。台账那边靠这个观察口
   *    才能把「这个站就这么多页」和「有一棵 sitemap 子树没取到」分开。
   *    上报点漏一个，就有一类缺页会重新变成静默的。
   */
  describe('onIssue — swallowed failures must be observable', () => {
    it('reports a child sitemap that throws', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))         // robots.txt
        .mockResolvedValueOnce(mockNotFound())                         // sitemap.xml 404
        .mockResolvedValueOnce(mockResponse(SITEMAP_INDEX_XML))        // sitemap_index.xml
        .mockRejectedValueOnce(new Error('Timeout'))                   // sitemap-posts.xml throws
        .mockResolvedValueOnce(mockResponse(SITEMAP_PAGES_XML))        // sitemap-pages.xml ok
      )
      const issues: DiscoveryIssue[] = []

      const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

      // 返回值跟「这个站只有 3 页」完全一样 —— 差别只在这个回调里。
      expect(urls).toHaveLength(3)
      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatchObject({ stage: 'child-sitemap', url: 'https://example.com/sitemap-posts.xml' })
      expect(issues[0].error).toContain('Timeout')
    })

    it('🔴 reports a child sitemap that answers non-OK (it never throws)', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockNotFound())
        .mockResolvedValueOnce(mockResponse(SITEMAP_INDEX_XML))
        .mockResolvedValueOnce(new Response('nope', { status: 503 }))  // sitemap-posts.xml 503
        .mockResolvedValueOnce(mockResponse(SITEMAP_PAGES_XML))
      )
      const issues: DiscoveryIssue[] = []

      const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

      expect(urls).toHaveLength(3)
      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatchObject({ stage: 'child-sitemap', url: 'https://example.com/sitemap-posts.xml' })
      expect(issues[0].error).toContain('503')
    })

    it('reports sitemaps dropped on the robots.txt directive path', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_WITH_SITEMAP))  // robots.txt (has Sitemap:)
        .mockRejectedValueOnce(new Error('ECONNRESET'))                // custom-sitemap.xml throws
        .mockResolvedValueOnce(mockResponse(SITEMAP_XML_10_URLS))      // sitemap.xml fallback
      )
      const issues: DiscoveryIssue[] = []

      await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

      expect(issues.some((i) => i.stage === 'sitemap-fetch' && i.url?.includes('custom-sitemap.xml'))).toBe(true)
    })

    it('reports a non-OK sitemap on the robots.txt directive path', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_WITH_SITEMAP))
        .mockResolvedValueOnce(new Response('gone', { status: 410 }))  // custom-sitemap.xml 410
        .mockResolvedValueOnce(mockResponse(SITEMAP_XML_10_URLS))
      )
      const issues: DiscoveryIssue[] = []

      await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

      expect(issues.some((i) => i.stage === 'sitemap-fetch' && i.error.includes('410'))).toBe(true)
    })

    it('🔴 reports the depth-limit cut-off on the direct-fetch path', async () => {
      // robots.txt → custom-sitemap.xml → 一条只有 index 的链，第 4 层被截断。
      // 截断后返回的是空数组，跟「这棵子树本来就是空的」一模一样。
      const indexTo = (child: string) =>
        mockResponse(`<sitemapindex><sitemap><loc>${child}</loc></sitemap></sitemapindex>`)
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_WITH_SITEMAP))              // robots.txt
        .mockResolvedValueOnce(indexTo('https://example.com/sitemap-b.xml'))       // depth 0
        .mockResolvedValueOnce(indexTo('https://example.com/sitemap-c.xml'))       // depth 1
        .mockResolvedValueOnce(indexTo('https://example.com/sitemap-d.xml'))       // depth 2
        .mockResolvedValue(mockResponse(SITEMAP_XML_10_URLS))                      // 后续回退
      )
      const issues: DiscoveryIssue[] = []

      await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

      expect(issues.some((i) => i.stage === 'sitemap-depth-limit')).toBe(true)
      expect(issues.find((i) => i.stage === 'sitemap-depth-limit')?.url).toBe(
        'https://example.com/sitemap-d.xml',
      )
    })

    it('🔴 reports when the result came from homepage BFS (best-effort, cannot enumerate a site)', async () => {
      // sitemap 全挂、靠首页链接凑出来的结果，跟「这个站就这么多页」长得一模一样。
      // 危险的不是 sitemap 404（那是正常回退），是**最后靠首页凑出来**这件事。
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockNotFound())
        .mockResolvedValueOnce(mockNotFound())
        .mockResolvedValueOnce(mockResponse('<a href="/a">a</a><a href="/b">b</a>'))
      )
      const issues: DiscoveryIssue[] = []
      const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

      expect(urls.length).toBeGreaterThanOrEqual(2)
      expect(issues.map((i) => i.stage)).toContain('homepage-bfs-only')
    })

    it('🔴 reports when homepage BFS hit the link cap (the rest are silently absent)', async () => {
      // 截到 MAX_BFS_LINKS 就返回，截断跟「这个站就这么多页」长得一样。
      const many = Array.from({ length: 80 }, (_, i) => `<a href="/p${i}">p${i}</a>`).join('')
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockNotFound())
        .mockResolvedValueOnce(mockNotFound())
        .mockResolvedValueOnce(mockResponse(many))
      )
      const issues: DiscoveryIssue[] = []
      const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

      expect(urls).toHaveLength(MAX_BFS_LINKS)
      expect(issues.map((i) => i.stage)).toContain('homepage-bfs-truncated')
    })

    it('stays silent when discovery is complete', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockNotFound())
        .mockResolvedValueOnce(mockResponse(SITEMAP_INDEX_XML))
        .mockResolvedValueOnce(mockResponse(SITEMAP_POSTS_XML))
        .mockResolvedValueOnce(mockResponse(SITEMAP_PAGES_XML))
      )
      const issues: DiscoveryIssue[] = []

      const urls = await discoverSitemapUrls('example.com', { onIssue: (i) => issues.push(i) })

      // sitemap.xml 的 404 是正常回退，不是「被吞掉的失败」—— 报它只会把噪音喂给
      // 「不完整必须有人认过」那道闸，认多了就没人认真看了。
      expect(urls).toHaveLength(6)
      expect(issues).toEqual([])
    })

    it('behaves exactly as before when no onIssue is passed', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockNotFound())
        .mockResolvedValueOnce(mockResponse(SITEMAP_INDEX_XML))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce(mockResponse(SITEMAP_PAGES_XML))
      vi.stubGlobal('fetch', fetchMock)

      await expect(discoverSitemapUrls('example.com')).resolves.toHaveLength(3)
    })
  })

  describe('fallback 2 — robots.txt contains Sitemap directive', () => {
    it('discovers URLs from custom sitemap listed in robots.txt', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_WITH_SITEMAP))  // robots.txt (has Sitemap:)
        .mockResolvedValueOnce(mockResponse(CUSTOM_SITEMAP_XML))       // custom-sitemap.xml
      )

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(3)
      expect(urls).toContain('https://example.com/custom-1')
    })

    it('skips failed robots.txt sitemap directive fetch and falls through (covers resolveSitemapUrls catch)', async () => {
      // robots.txt has Sitemap: but fetching it throws — should fall through to sitemap.xml
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_WITH_SITEMAP))  // robots.txt (has Sitemap:)
        .mockRejectedValueOnce(new Error('DNS failure'))               // custom-sitemap.xml throws
        .mockResolvedValueOnce(mockResponse(SITEMAP_XML_10_URLS))      // sitemap.xml succeeds
      )

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(10)
    })
  })

  describe('fallback 3 — BFS homepage link extraction', () => {
    it('returns 5 same-domain links when all sitemaps fail', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))         // robots.txt (no Sitemap:)
        .mockResolvedValueOnce(mockNotFound())                         // sitemap.xml 404
        .mockResolvedValueOnce(mockNotFound())                         // sitemap_index.xml 404
        .mockResolvedValueOnce(mockResponse(HOMEPAGE_HTML_WITH_LINKS, 200)) // homepage
      )

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(5)
      expect(urls.every(u => u.startsWith('https://example.com'))).toBe(true)
    })

    it('excludes external domain links from BFS results', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockNotFound())
        .mockResolvedValueOnce(mockNotFound())
        .mockResolvedValueOnce(mockResponse(HOMEPAGE_HTML_WITH_LINKS, 200))
      )

      const urls = await discoverSitemapUrls('example.com')
      expect(urls.every(u => !u.startsWith('https://other-domain.com'))).toBe(true)
    })
  })

  describe('edge case — robots.txt blocks all crawling', () => {
    it('returns empty array when Disallow: / is set', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_BLOCKING_ALL))  // robots.txt
      )

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toEqual([])
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('disallows all crawling'))
      warnSpy.mockRestore()
    })

    it('logs a warning message when blocked', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_BLOCKING_ALL))
      )

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await discoverSitemapUrls('example.com')
      expect(warnSpy).toHaveBeenCalledTimes(1)
      warnSpy.mockRestore()
    })
  })

  describe('edge case — all strategies fail', () => {
    it('returns empty array when fetch throws on every attempt', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toEqual([])
    })
  })

  describe('WAF-blocked domain — Jina escalation (2026-08-01 Oztop/SiteGround)', () => {
    const CHALLENGE_HTML_ONE_LINK = `<!DOCTYPE html>
<html><head><title>Checking your browser</title></head>
<body><h1>One moment please...</h1>
<a href="https://example.com/">Retry</a>
</body></html>`

    it('discovers full sitemap via Jina when every direct fetch is blocked', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse('Forbidden', 403)))
      vi.mocked(fetchUrlRaw).mockResolvedValue(SITEMAP_XML_10_URLS)

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(10)
      expect(vi.mocked(fetchUrlRaw)).toHaveBeenCalledWith('https://example.com/sitemap.xml')
    })

    it('escalates past a 1-link challenge page instead of returning it (the Oztop bug)', async () => {
      // Direct homepage fetch "succeeds" but returns a WAF challenge page with
      // exactly one same-domain link — previously the crawler returned that
      // single URL and never reached the Jina levels.
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockNotFound())                             // robots.txt
        .mockResolvedValueOnce(mockNotFound())                             // sitemap.xml
        .mockResolvedValueOnce(mockNotFound())                             // sitemap_index.xml
        .mockResolvedValueOnce(mockResponse(CHALLENGE_HTML_ONE_LINK, 200)) // homepage (challenge)
      )
      vi.mocked(fetchUrlRaw).mockResolvedValue(SITEMAP_XML_10_URLS)

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(10)
      expect(urls).toContain('https://example.com/page-1')
    })

    it('falls back to the best direct result when Jina also fails', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockNotFound())                             // robots.txt
        .mockResolvedValueOnce(mockNotFound())                             // sitemap.xml
        .mockResolvedValueOnce(mockNotFound())                             // sitemap_index.xml
        .mockResolvedValueOnce(mockResponse(CHALLENGE_HTML_ONE_LINK, 200)) // homepage (challenge)
      )
      // Jina mocks stay rejected (beforeEach default)

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toEqual(['https://example.com/'])
    })

    it('recovers URLs when Jina strips the XML tags (bare-URL fallback)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('blocked')))
      vi.mocked(fetchUrlRaw).mockResolvedValue(`XML Sitemap
https://example.com/page-1
https://example.com/page-2
https://example.com/page-3
https://other-domain.com/external`)

      const urls = await discoverSitemapUrls('example.com')
      expect(urls).toHaveLength(3)
      expect(urls.every(u => u.startsWith('https://example.com'))).toBe(true)
    })

    it('does not call Jina when a direct level already found enough URLs', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(mockResponse(ROBOTS_TXT_EMPTY))
        .mockResolvedValueOnce(mockResponse(SITEMAP_XML_10_URLS))
      )

      await discoverSitemapUrls('example.com')
      expect(vi.mocked(fetchUrlRaw)).not.toHaveBeenCalled()
      expect(vi.mocked(fetchUrlAsMarkdown)).not.toHaveBeenCalled()
    })

    it('MIN_DISCOVERED_URLS is 2', () => {
      expect(MIN_DISCOVERED_URLS).toBe(2)
    })
  })
})
