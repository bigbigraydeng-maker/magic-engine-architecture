/**
 * sitemap-root — decide whether a sitemap response is a `<sitemapindex>` by
 * looking at its actual XML **root element**, not at the document text.
 *
 * 🔴 Codex review on PR #963 (P2). The crawler used `/<sitemapindex/i.test(xml)`
 *    on the whole response. A perfectly valid `<urlset>` that merely *mentions*
 *    the string — a generator leaving `<!-- migrated from <sitemapindex> -->`,
 *    or the word appearing in text content — was then treated as an index, so
 *    every real page `<loc>` got fetched as if it were a child sitemap and the
 *    site's actual page list was lost.
 *
 *    The fix is not a bigger regex. A wider full-text pattern would be just as
 *    unprovable; the property we need ("what is the root element?") is
 *    positional, so this module walks the prolog once and stops at the first
 *    element. No XML dependency: a sitemap prolog is a tiny, closed grammar
 *    (BOM, whitespace, processing instructions, comments, doctype) and a
 *    50-line scanner over it is far easier to test exhaustively than a parser
 *    is to justify pulling in.
 *
 * Fail direction: anything this scanner cannot make sense of returns `null`,
 * which callers read as "not an index". That is the conservative side — an
 * unrecognised document is parsed for page `<loc>`s (the pre-existing default)
 * rather than fanned out into N attacker-chosen network requests.
 */

/** Whitespace plus a stray UTF-8 BOM, which survives some decoders. */
const PROLOG_SKIP = /[\s﻿]/

/** A qualified name may not start with these, and ends at the first of them. */
const NAME_START_FORBIDDEN = /[\s/>!?]/
const NAME_END = /[\s/>]/

/**
 * The local name (namespace prefix stripped, lower-cased) of the document's
 * root element, or `null` if there isn't one this scanner can identify.
 *
 * Handles, before the root element: a UTF-8 BOM, leading whitespace, the XML
 * declaration and any other processing instruction, XML comments, and a
 * doctype. Exported for its own unit tests.
 */
export function readXmlRootElementName(xml: string): string | null {
  let i = 0
  while (i < xml.length) {
    if (PROLOG_SKIP.test(xml[i])) { i++; continue }
    if (xml[i] !== '<') return null // character data before the root element

    if (xml[i + 1] === '?') {
      // `<?xml ... ?>` or e.g. `<?xml-stylesheet ... ?>`
      const end = xml.indexOf('?>', i + 2)
      if (end === -1) return null
      i = end + 2
      continue
    }
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4)
      if (end === -1) return null
      i = end + 3
      continue
    }
    if (xml[i + 1] === '!') {
      // A doctype. Sitemaps have no legitimate internal subset, so scanning to
      // the first '>' is enough; a subset containing '>' would land mid-decl
      // and fall out as `null`, i.e. "not an index" — the safe direction.
      const end = xml.indexOf('>', i)
      if (end === -1) return null
      i = end + 1
      continue
    }

    // The root element's start tag. Scanned character by character rather than
    // matched with a regex, so a very large document is never sliced or
    // re-scanned from the start.
    const nameStart = i + 1
    if (nameStart >= xml.length || NAME_START_FORBIDDEN.test(xml[nameStart])) return null
    let nameEnd = nameStart
    while (nameEnd < xml.length && !NAME_END.test(xml[nameEnd])) nameEnd++
    if (nameEnd >= xml.length) return null // unterminated start tag
    const qualifiedName = xml.slice(nameStart, nameEnd)
    const colon = qualifiedName.lastIndexOf(':')
    return (colon === -1 ? qualifiedName : qualifiedName.slice(colon + 1)).toLowerCase()
  }
  return null
}

/**
 * True only when the document's root element is `<sitemapindex>` — with or
 * without attributes, a namespace declaration or a namespace prefix.
 *
 * This is the single shared criterion: Level 1 in `discoverSitemapUrls()` and
 * the recursive `fetchSitemapPageUrls()` must both call it, so the two paths
 * cannot drift into disagreeing about what an index is.
 */
export function isSitemapIndexDocument(xml: string): boolean {
  return readXmlRootElementName(xml) === 'sitemapindex'
}
