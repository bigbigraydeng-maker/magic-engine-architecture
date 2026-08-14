/**
 * sitemap-fetch — read exactly one sitemap document: within the run's shared
 * request allowance, through the shared connection-bound SSRF-safe primitive,
 * and with every rejection translated into a stable DiscoveryIssue stage.
 *
 * Split out of crawler.ts so that file stays under the repo's 800-line cap
 * after the budget/root-element work landed. crawler.ts keeps discovery
 * orchestration (which levels run, in what order, recursion depth); this file
 * owns the single-document read and nothing else.
 */

import {
  safeFetchText,
  BlockedAddressError,
  DisallowedSchemeError,
  InvalidRedirectError,
  TooManyRedirectsError,
} from '@/lib/net/safe-fetch'
import type { SitemapFetchBudget } from './sitemap-budget'

/** 失败上报口。默认空实现 = 既有行为。 */
export type Report = (stage: string, error: unknown, url?: string) => void

/** Separate cap from crawler.ts's MAX_SITEMAP_DEPTH — this bounds redirect hops
 *  for a single sitemap fetch, not the depth of nested sitemap indexes. */
export const MAX_SITEMAP_REDIRECTS = 3

/**
 * 🔴 Codex review on PR #963 (P2): safeFetchText's 10 MiB default sits *below*
 * the 50 MB one uncompressed sitemap may be, so a large but perfectly legal
 * sitemap would fail with ResponseTooLargeError where the previous unbounded
 * fetch() succeeded — and the Jina fallback truncates at 1,000,000 chars, so it
 * cannot recover those pages either. The read stays bounded; the bound is just
 * the protocol's own limit instead of the primitive's generic default.
 */
const MAX_SITEMAP_RESPONSE_BYTES = 52_428_800 // 50 MB, sitemaps.org

/**
 * Every sitemap read goes through safeFetchText() with these
 * options. Timeout and DNS timeout stay at the primitive's defaults — restating
 * them here would just be a second place to keep in sync.
 */
const SITEMAP_FETCH_OPTIONS = {
  maxRedirects: MAX_SITEMAP_REDIRECTS,
  maxResponseBytes: MAX_SITEMAP_RESPONSE_BYTES,
} as const

export type SafeSitemapFetch =
  | { ok: true; xml: string }
  | { ok: false }

/**
 * Map an error thrown by safeFetchText() onto the crawler's existing
 * DiscoveryIssue stage names. 🔴 The stages are a public contract: the
 * canonical-inventory adapter and the onIssue tests both key off them, so
 * consuming a shared primitive must not silently re-label a rejection. Anything
 * the primitive does not classify (network/TLS error, timeout, oversized body,
 * DNS failure) keeps the caller's own "genuinely unreachable" stage — which is
 * what those failures were reported as before.
 */
function sitemapFailureStage(err: unknown, genericFailureStage: string): string {
  if (err instanceof BlockedAddressError) return 'sitemap-blocked-host'
  if (err instanceof DisallowedSchemeError) return 'sitemap-unsupported-scheme'
  if (err instanceof TooManyRedirectsError) return 'sitemap-too-many-redirects'
  if (err instanceof InvalidRedirectError) return 'sitemap-redirect-without-location'
  if ((err as NodeJS.ErrnoException)?.code === 'ERR_INVALID_URL') return 'sitemap-invalid-url'
  return genericFailureStage
}

/**
 * Fetch `url` expecting sitemap XML, through the shared connection-bound
 * SSRF-safe primitive (`src/lib/net/safe-fetch.ts`, PR #970 / issue #965).
 *
 * 🔴 SSRF review on PR #963: every <loc> in a sitemap is attacker-controlled —
 *    the site owner (or whoever compromised it) writes the sitemap content.
 *    Before this fix, fetchSitemapPageUrls() called fetch(url) directly with
 *    automatic redirect-following, so a <loc>http://169.254.169.254/...</loc>
 *    — or a public-looking <loc> that 302-redirects to an internal address —
 *    was requested straight from Render's own network, unchecked. Same-host
 *    filtering (dedupeAndFilter) only trims the *returned* list; it can't
 *    recall a request that already went out over the wire.
 *
 *    This function deliberately owns **no** address, scheme, redirect, timeout
 *    or size logic. #963's first attempt did, and its handwritten string-prefix
 *    IP rules had real bypasses (fea0::1, ::ffff:7f00:1) plus a DNS TOCTOU gap.
 *    safeFetchText() resolves every candidate address, fails closed if any is
 *    disallowed, and pins the validated address to the socket, per hop. All
 *    this file does is translate a rejection into a DiscoveryIssue — always via
 *    `report()`, never thrown, so one poisoned <loc> in an index doesn't stop
 *    its legitimate siblings from being fetched.
 */
export interface SitemapReadOptions {
  /**
   * Stage name for "genuinely unreachable" failures (network error / non-OK
   * response / DNS failure). Each entry point has its own ('sitemap.xml',
   * 'sitemap_index.xml', 'sitemap-fetch', 'child-sitemap'), which existing
   * onIssue tests assert on; the SSRF-specific stages in sitemapFailureStage()
   * are shared verbatim by all of them.
   */
  readonly failureStage?: string
  /**
   * When true, a non-OK HTTP status is a normal negative probe result rather
   * than a swallowed failure, so it is not reported. Level 1 (`/sitemap.xml`)
   * and Level 2 (`/sitemap_index.xml`) guess well-known paths — a 404 there is
   * the ordinary fallback signal and has always been silent. A child named by
   * an index is different: the document promised it exists, so its 404 is a
   * missing subtree and must be reported.
   */
  readonly silentOnHttpError?: boolean
}

export async function fetchSitemapXmlSafely(
  startUrl: string,
  report: Report,
  budget: SitemapFetchBudget,
  options: SitemapReadOptions = {},
): Promise<SafeSitemapFetch> {
  const genericFailureStage = options.failureStage ?? 'sitemap-fetch'
  const claim = budget.claim(startUrl)
  if (!claim.fetch) {
    // A duplicate is silent — it is not a failure, the URL was already covered.
    // Running out of allowance IS a truncated result, so it is reported once
    // per run (not once per skipped child) and pages found so far are kept.
    if (claim.reason === 'budget-exhausted' && budget.takeOverrunNotice()) {
      report('sitemap-fetch-limit', `sitemap fetch limit ${budget.limit} reached`, startUrl)
    }
    return { ok: false }
  }
  try {
    const res = await safeFetchText(claim.url, SITEMAP_FETCH_OPTIONS)
    if (!res.ok) {
      if (!options.silentOnHttpError) report(genericFailureStage, `HTTP ${res.status}`, startUrl)
      return { ok: false }
    }
    return { ok: true, xml: res.text }
  } catch (err) {
    // `url` is the sitemap entry that failed, not the hop it failed on — the
    // blocked hop is named in the error message (safeFetchText owns the loop).
    report(sitemapFailureStage(err, genericFailureStage), err, startUrl)
    return { ok: false }
  }
}
