/**
 * sitemap-budget — one shared "how many sitemap documents may this discovery
 * run fetch, and which has it already fetched" ledger.
 *
 * 🔴 Codex review on PR #963 (P2). MAX_SITEMAP_DEPTH bounds how *deep* the
 *    recursion goes and nothing else — each level was free to be arbitrarily
 *    *wide*. A valid sitemap index may list 50,000 children, and each safe
 *    fetch can wait out several 10-second redirect hops, so one hostile (or
 *    merely careless) index could keep a discovery job running for days and
 *    re-request the same address over and over.
 *
 *    Depth and width are different bounds, so this does not replace the depth
 *    limit — both stay. One budget instance is created per
 *    `discoverSitemapUrls()` call and threaded through every entry point
 *    (Level 1, robots.txt directives, Level 2, and the recursive index
 *    expansion), so no level can hand itself a fresh allowance.
 */

/** Total sitemap documents one discovery run may request, across all levels. */
export const MAX_SITEMAP_FETCHES = 50

export type SitemapFetchDecision =
  /** Claimed: fetch exactly this (normalised) URL. */
  | { readonly fetch: true; readonly url: string }
  /** Some level already requested this URL in this run. */
  | { readonly fetch: false; readonly reason: 'already-fetched' }
  /** The run has spent its whole allowance. */
  | { readonly fetch: false; readonly reason: 'budget-exhausted' }

export interface SitemapFetchBudget {
  readonly limit: number
  /** How many distinct sitemap URLs have been claimed so far. */
  spent(): number
  /**
   * Normalise, then de-duplicate, then charge the budget — in that order, so a
   * repeated URL never costs an allowance slot it does not need.
   */
  claim(rawUrl: string): SitemapFetchDecision
  /**
   * True the first time it is called after the budget ran out, false every
   * time after. Lets the caller emit exactly one `sitemap-fetch-limit` issue
   * per run instead of one per skipped child.
   */
  takeOverrunNotice(): boolean
}

/**
 * Canonical form used for de-duplication *and* for the actual request, so the
 * two can never disagree. `URL` normalises scheme/host case, default ports and
 * path escaping; the fragment is dropped because it is never sent on the wire,
 * so `…/s.xml` and `…/s.xml#a` are one request. Unparseable input is passed
 * through trimmed — `safeFetchText` is what classifies it as an invalid URL,
 * and it still gets de-duplicated by its raw text.
 */
function normaliseSitemapUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    url.hash = ''
    return url.href
  } catch {
    return rawUrl.trim()
  }
}

export function createSitemapFetchBudget(limit: number = MAX_SITEMAP_FETCHES): SitemapFetchBudget {
  const claimed = new Set<string>()
  let overrunReported = false

  return {
    limit,
    spent: () => claimed.size,
    claim(rawUrl: string): SitemapFetchDecision {
      const url = normaliseSitemapUrl(rawUrl)
      if (claimed.has(url)) return { fetch: false, reason: 'already-fetched' }
      if (claimed.size >= limit) return { fetch: false, reason: 'budget-exhausted' }
      claimed.add(url)
      return { fetch: true, url }
    },
    takeOverrunNotice(): boolean {
      if (overrunReported) return false
      overrunReported = true
      return true
    },
  }
}
