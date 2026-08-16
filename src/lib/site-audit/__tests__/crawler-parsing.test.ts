/**
 * Site Auditor Crawler — parser/helper unit tests (pure functions, no fetch mocking).
 *
 * Split out of crawler.test.ts (Codex review on PR #963, P1 — the combined
 * file exceeded the repo's 800-line-per-file cap). Covers: normaliseDomain,
 * parseLocsFromXml (incl. XML entity decoding), parseSitemapDirectives,
 * isFullyCrawlBlocked, extractSameDomainLinks, extractTitle, extractBareUrls.
 * See crawler-test-files.ts for the fixed manifest of all split files.
 */

import { describe, it, expect } from 'vitest'
import {
  normaliseDomain,
  parseLocsFromXml,
  parseSitemapDirectives,
  isFullyCrawlBlocked,
  extractSameDomainLinks,
  extractBareUrls,
  extractTitle,
} from '../crawler'
import {
  SITEMAP_XML_10_URLS,
  SITEMAP_INDEX_XML,
  ROBOTS_TXT_WITH_SITEMAP,
  ROBOTS_TXT_BLOCKING_ALL,
  ROBOTS_TXT_EMPTY,
  HOMEPAGE_HTML_WITH_LINKS,
  MARKDOWN_WITH_H1,
  MARKDOWN_WITH_TITLE_TAG,
  MARKDOWN_NO_TITLE,
} from './crawler-fixtures'

describe('normaliseDomain', () => {
  it('strips path and query from full URL', () => {
    expect(normaliseDomain('https://example.com/path?q=1')).toBe('https://example.com')
  })

  it('adds https:// when scheme is missing', () => {
    expect(normaliseDomain('example.com')).toBe('https://example.com')
  })

  it('keeps https:// when already present', () => {
    expect(normaliseDomain('https://example.com')).toBe('https://example.com')
  })

  it('handles http:// input unchanged', () => {
    expect(normaliseDomain('http://example.com')).toBe('http://example.com')
  })

  it('removes trailing slash', () => {
    expect(normaliseDomain('https://example.com/')).toBe('https://example.com')
  })
})

describe('parseLocsFromXml', () => {
  it('extracts 10 URLs from a full sitemap', () => {
    const locs = parseLocsFromXml(SITEMAP_XML_10_URLS)
    expect(locs).toHaveLength(10)
    expect(locs[0]).toBe('https://example.com/page-1')
    expect(locs[9]).toBe('https://example.com/page-10')
  })

  it('returns empty array for XML with no <loc> tags', () => {
    expect(parseLocsFromXml('<urlset></urlset>')).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseLocsFromXml('')).toEqual([])
  })

  it('handles whitespace around URLs inside <loc>', () => {
    const xml = '<urlset><url><loc>  https://example.com/page  </loc></url></urlset>'
    const locs = parseLocsFromXml(xml)
    expect(locs).toHaveLength(1)
    expect(locs[0]).toBe('https://example.com/page')
  })

  it('extracts child sitemap URLs from a sitemap_index', () => {
    const locs = parseLocsFromXml(SITEMAP_INDEX_XML)
    expect(locs).toHaveLength(2)
    expect(locs[0]).toBe('https://example.com/sitemap-posts.xml')
  })

  /**
   * Codex review on PR #963 (P2): sitemap XML escapes `&` as `&amp;` per spec
   * — a <loc> with a multi-param query string is written with the entity,
   * not the raw character. Decoding must happen at this shared parsing
   * boundary so every caller (Level 1/2, robots directive, sitemap-index
   * recursion, Jina fallback) gets it, not just one call site.
   */
  describe('XML entity decoding in <loc>', () => {
    it('decodes &amp; to & in a multi-param query string', () => {
      const xml = '<urlset><url><loc>https://example.com/sitemap.php?type=post&amp;page=2</loc></url></urlset>'
      const locs = parseLocsFromXml(xml)
      expect(locs).toEqual(['https://example.com/sitemap.php?type=post&page=2'])
    })

    it('decodes a decimal numeric entity (&#38;) to &', () => {
      const xml = '<urlset><url><loc>https://example.com/search?a=1&#38;b=2</loc></url></urlset>'
      const locs = parseLocsFromXml(xml)
      expect(locs).toEqual(['https://example.com/search?a=1&b=2'])
    })

    it('decodes a hex numeric entity (&#x26;) to &', () => {
      const xml = '<urlset><url><loc>https://example.com/search?a=1&#x26;b=2</loc></url></urlset>'
      const locs = parseLocsFromXml(xml)
      expect(locs).toEqual(['https://example.com/search?a=1&b=2'])
    })

    it('decodes an uppercase hex numeric entity (&#X26;) to &', () => {
      const xml = '<urlset><url><loc>https://example.com/search?a=1&#X26;b=2</loc></url></urlset>'
      const locs = parseLocsFromXml(xml)
      expect(locs).toEqual(['https://example.com/search?a=1&b=2'])
    })

    it('never returns a URL containing the literal substring "amp;"', () => {
      const xml = '<urlset><url><loc>https://example.com/sitemap.php?type=post&amp;page=2&amp;lang=en</loc></url></urlset>'
      const locs = parseLocsFromXml(xml)
      expect(locs[0]).not.toContain('amp;')
      expect(locs).toEqual(['https://example.com/sitemap.php?type=post&page=2&lang=en'])
    })

    it('leaves an already-normal URL with no entities completely unchanged', () => {
      const locs = parseLocsFromXml(SITEMAP_XML_10_URLS)
      expect(locs[0]).toBe('https://example.com/page-1')
    })

    it('does not double-decode an XML-escaped literal "&amp;" string (&amp;amp; → &amp;, not &)', () => {
      // A sitemap that genuinely wants the literal text "&amp;" to survive into
      // the URL must escape the ampersand itself, writing &amp;amp; in the XML
      // source. A single decode pass must leave it as "&amp;" — decoding twice
      // would over-decode it down to "&", corrupting an already-normal value.
      const xml = '<urlset><url><loc>https://example.com/page?raw=&amp;amp;</loc></url></urlset>'
      const locs = parseLocsFromXml(xml)
      expect(locs).toEqual(['https://example.com/page?raw=&amp;'])
    })

    /**
     * Codex review on PR #963 (2nd P2): parseInt() never throws, but
     * String.fromCodePoint() does for out-of-range values — and this ran
     * inside the one parse call for the whole sitemap, so a single malformed
     * <loc> used to abort parsing and drop every valid page in the same file.
     */
    describe('rejects out-of-range numeric entities instead of throwing', () => {
      it('does not throw for a decimal entity one past the Unicode ceiling (&#1114112;)', () => {
        const xml = '<urlset><url><loc>https://example.com/page?x=&#1114112;</loc></url></urlset>'
        expect(() => parseLocsFromXml(xml)).not.toThrow()
        expect(parseLocsFromXml(xml)).toEqual(['https://example.com/page?x=&#1114112;'])
      })

      it('does not throw for a hex entity one past the Unicode ceiling (&#x110000;)', () => {
        const xml = '<urlset><url><loc>https://example.com/page?x=&#x110000;</loc></url></urlset>'
        expect(() => parseLocsFromXml(xml)).not.toThrow()
        expect(parseLocsFromXml(xml)).toEqual(['https://example.com/page?x=&#x110000;'])
      })

      it('does not throw for a surrogate-half entity (&#xD800;)', () => {
        const xml = '<urlset><url><loc>https://example.com/page?x=&#xD800;</loc></url></urlset>'
        expect(() => parseLocsFromXml(xml)).not.toThrow()
        expect(parseLocsFromXml(xml)).toEqual(['https://example.com/page?x=&#xD800;'])
      })

      it('does not throw for an absurdly long numeric entity (overflows to Infinity)', () => {
        const hugeDigits = '9'.repeat(400)
        const xml = `<urlset><url><loc>https://example.com/page?x=&#${hugeDigits};</loc></url></urlset>`
        expect(() => parseLocsFromXml(xml)).not.toThrow()
        expect(parseLocsFromXml(xml)).toEqual([`https://example.com/page?x=&#${hugeDigits};`])
      })

      it('still extracts the valid <loc> when a malformed one sits right next to it', () => {
        const xml = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://example.com/bad?x=&#1114112;</loc></url>
  <url><loc>https://example.com/good</loc></url>
</urlset>`
        expect(() => parseLocsFromXml(xml)).not.toThrow()
        const locs = parseLocsFromXml(xml)
        expect(locs).toContain('https://example.com/good')
        expect(locs).toHaveLength(2)
      })

      it('still decodes legal numeric entities at the exact boundary values', () => {
        // 0x10FFFF is the highest legal code point; 0xD7FF/0xE000 are the
        // legal values immediately outside the surrogate gap on each side.
        const xml = `<urlset>
  <url><loc>https://example.com/max?x=&#x10FFFF;</loc></url>
  <url><loc>https://example.com/before-surrogate?x=&#xD7FF;</loc></url>
  <url><loc>https://example.com/after-surrogate?x=&#xE000;</loc></url>
</urlset>`
        const locs = parseLocsFromXml(xml)
        expect(locs[0]).toBe(`https://example.com/max?x=${String.fromCodePoint(0x10ffff)}`)
        expect(locs[1]).toBe(`https://example.com/before-surrogate?x=${String.fromCodePoint(0xd7ff)}`)
        expect(locs[2]).toBe(`https://example.com/after-surrogate?x=${String.fromCodePoint(0xe000)}`)
      })
    })
  })
})

describe('parseSitemapDirectives', () => {
  it('extracts Sitemap: directive from robots.txt', () => {
    const directives = parseSitemapDirectives(ROBOTS_TXT_WITH_SITEMAP)
    expect(directives).toHaveLength(1)
    expect(directives[0]).toBe('https://example.com/custom-sitemap.xml')
  })

  it('returns empty array when no Sitemap directives present', () => {
    expect(parseSitemapDirectives(ROBOTS_TXT_EMPTY)).toEqual([])
  })

  it('returns empty array for empty robots.txt', () => {
    expect(parseSitemapDirectives('')).toEqual([])
  })

  it('handles multiple Sitemap directives', () => {
    const robots = `User-agent: *\nSitemap: https://example.com/s1.xml\nSitemap: https://example.com/s2.xml`
    const directives = parseSitemapDirectives(robots)
    expect(directives).toHaveLength(2)
  })
})

describe('isFullyCrawlBlocked', () => {
  it('returns true when User-agent: * has Disallow: /', () => {
    expect(isFullyCrawlBlocked(ROBOTS_TXT_BLOCKING_ALL)).toBe(true)
  })

  it('returns false when Disallow is absent', () => {
    expect(isFullyCrawlBlocked(ROBOTS_TXT_EMPTY)).toBe(false)
  })

  it('returns false when Disallow: / is under a specific bot, not wildcard', () => {
    const robots = `User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nAllow: /`
    expect(isFullyCrawlBlocked(robots)).toBe(false)
  })

  it('returns false for empty robots.txt', () => {
    expect(isFullyCrawlBlocked('')).toBe(false)
  })
})

describe('extractSameDomainLinks', () => {
  const origin = 'https://example.com'

  it('returns 5 same-domain links and excludes external domains', () => {
    const links = extractSameDomainLinks(HOMEPAGE_HTML_WITH_LINKS, origin)
    expect(links).toHaveLength(5)
    expect(links.every(l => l.startsWith(origin))).toBe(true)
  })

  it('resolves relative hrefs to absolute URLs', () => {
    const html = '<a href="/about">About</a>'
    const links = extractSameDomainLinks(html, origin)
    expect(links).toContain('https://example.com/about')
  })

  it('de-duplicates URLs', () => {
    const html = '<a href="/page">P</a><a href="/page">P again</a>'
    const links = extractSameDomainLinks(html, origin)
    expect(links).toHaveLength(1)
  })

  it('respects the max parameter', () => {
    let html = ''
    for (let i = 0; i < 10; i++) html += `<a href="/p${i}">P</a>`
    const links = extractSameDomainLinks(html, origin, 3)
    expect(links).toHaveLength(3)
  })

  it('returns empty array for HTML with no links', () => {
    expect(extractSameDomainLinks('<p>No links</p>', origin)).toEqual([])
  })

  it('ignores mailto: and javascript: hrefs without throwing', () => {
    const html = '<a href="mailto:x@y.com">M</a><a href="javascript:void(0)">J</a>'
    const links = extractSameDomainLinks(html, origin)
    expect(links).toEqual([])
  })

  it('silently skips completely malformed href values (covers catch branch)', () => {
    // An href with null bytes cannot be parsed by URL() and triggers the catch
    const html = '<a href=" bad href">bad</a><a href="/valid">valid</a>'
    const links = extractSameDomainLinks(html, origin)
    // Only /valid should survive
    expect(links).toContain('https://example.com/valid')
  })

  /**
   * Codex review on PR #963 (P2): `new URL()` parses `ftp://example.com/f`,
   * `data://example.com/x` and `javascript://example.com/x` into a hostname
   * equal to the site's own, so hostname equality alone would admit them.
   */
  describe('non-web schemes with a matching hostname (Codex review P2)', () => {
    it('excludes same-host ftp:, data: and javascript: absolute hrefs', () => {
      const html = `<a href="ftp://example.com/file">ftp</a>
        <a href="data://example.com/payload">data</a>
        <a href="javascript://example.com/x">js</a>`
      expect(extractSameDomainLinks(html, origin)).toEqual([])
    })

    it('keeps same-host http:, https: and relative hrefs alongside them', () => {
      const html = `<a href="ftp://example.com/file">ftp</a>
        <a href="https://example.com/secure">https</a>
        <a href="http://example.com/plain">http</a>
        <a href="/relative">relative</a>`
      expect(extractSameDomainLinks(html, origin)).toEqual([
        'https://example.com/secure',
        'http://example.com/plain',
        'https://example.com/relative',
      ])
    })

    it('does not let a rejected scheme consume one of the `max` slots', () => {
      // 3 ftp: links first, then 2 real pages, with max = 2. If the rejected
      // links occupied slots, the loop would stop before reaching the pages.
      const html = `<a href="ftp://example.com/a">a</a>
        <a href="ftp://example.com/b">b</a>
        <a href="ftp://example.com/c">c</a>
        <a href="/page-1">1</a>
        <a href="/page-2">2</a>`
      expect(extractSameDomainLinks(html, origin, 2)).toEqual([
        'https://example.com/page-1',
        'https://example.com/page-2',
      ])
    })
  })

  it('does not throw when called with a non-URL origin (covers internal catch)', () => {
    // When origin is completely invalid, new URL(href, origin) throws for relative hrefs.
    // The function must silently skip those and not propagate the error.
    const html = '<a href="/page">page</a><a href="https://example.com/abs">abs</a>'
    expect(() => extractSameDomainLinks(html, 'not-a-valid-origin')).not.toThrow()
  })
})

describe('extractTitle', () => {
  it('extracts title from markdown H1 (priority 1)', () => {
    expect(extractTitle(MARKDOWN_WITH_H1, 'https://example.com/page')).toBe('My Amazing Page Title')
  })

  it('extracts title from <title> tag when no H1 present (priority 2)', () => {
    expect(extractTitle(MARKDOWN_WITH_TITLE_TAG, 'https://example.com/page')).toBe('HTML Title Tag Page')
  })

  it('falls back to hostname when neither H1 nor <title> present', () => {
    expect(extractTitle(MARKDOWN_NO_TITLE, 'https://example.com/page')).toBe('example.com')
  })

  it('H1 takes priority over <title> tag when both present', () => {
    const md = '# H1 Title\n<title>Title Tag</title>'
    expect(extractTitle(md, 'https://example.com')).toBe('H1 Title')
  })

  it('trims whitespace from extracted title', () => {
    const md = '#   Padded Title   \n'
    expect(extractTitle(md, 'https://example.com')).toBe('Padded Title')
  })

  it('falls back to raw url string when url is not parseable (covers catch branch)', () => {
    // Pass a non-URL string so new URL() throws
    const result = extractTitle(MARKDOWN_NO_TITLE, 'not-a-valid-url')
    expect(result).toBe('not-a-valid-url')
  })
})

describe('extractBareUrls', () => {
  it('extracts and de-duplicates bare URLs from text', () => {
    const text = 'see https://example.com/a and https://example.com/b plus https://example.com/a again'
    expect(extractBareUrls(text)).toEqual(['https://example.com/a', 'https://example.com/b'])
  })

  it('returns empty array when no URLs present', () => {
    expect(extractBareUrls('no links here')).toEqual([])
  })

  it('stops URLs at quotes and angle brackets', () => {
    const text = '<loc>https://example.com/x</loc> href="https://example.com/y"'
    expect(extractBareUrls(text)).toEqual(['https://example.com/x', 'https://example.com/y'])
  })
})
