/**
 * Prospect rule-based audit orchestrator — Step 2 of the outbound pipeline.
 *
 * Reference: ROADMAP.md Phase 35 (司马徽 outbound prospecting).
 *
 * Cost per prospect: one free homepage fetch + one DataForSEO OnPage
 * instant audit (~$0.003). No AI calls — qualification happens on rules
 * (score.ts) so only high-opportunity prospects reach the paid AI step.
 *
 * Safety: prospect website URLs come from Google Business listings, which
 * anyone can create — treat them as attacker-controlled. Redirects are
 * followed manually with a private-address check on every hop, and this
 * function never throws (a poison URL must not wedge the audit batch).
 */

import { getOnPageInstant, type OnPageResult } from '@/lib/dataforseo/onpage'
import { detectTrackingSignals, type TrackingSignals } from './tracking-detector'
import { isPrivateIp, isFetchableScheme, assertPublicHost, BlockedAddressError } from '@/lib/ssrf-safe-fetch'

// Re-exported so existing importers (and this file's own test suite) keep
// working unchanged — the SSRF rule itself now lives in ssrf-safe-fetch.ts,
// shared with site-audit/crawler.ts, so both call the identical check.
export { isPrivateIp }

export interface ProspectAudit {
  fetched_at:  string
  final_url:   string | null
  /**
   * true  = https homepage fetched successfully
   * false = definitively unreachable over https (DNS / connection / TLS failure)
   * null  = indeterminate (invalid URL, blocked by WAF, timeout, non-2xx) —
   *         must NOT be scored as "no SSL" (it may be a protected modern site).
   */
  https_ok:    boolean | null
  fetch_error: string | null
  tracking:    TrackingSignals | null
  onpage:      OnPageResult | null
}

const FETCH_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 3
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/** Exported for tests. Returns null instead of throwing on malformed input. */
export function normaliseUrl(raw: string): string | null {
  let u = raw.trim()
  if (!u) return null
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  try {
    const parsed = new URL(u)
    parsed.protocol = 'https:'
    return parsed.href
  } catch {
    return null
  }
}

// ─── Homepage fetch ───────────────────────────────────────────────────────────

type FetchOutcome =
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; https_ok: false | null; error: string }

/** Error codes that prove the site is down/absent at the network layer. */
const HARD_FAILURE_CODES = /^(ENOTFOUND|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|CERT_|ERR_TLS|ERR_SSL|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED)/

function classifyFetchError(err: unknown): { https_ok: false | null; error: string } {
  if (err instanceof BlockedAddressError) return { https_ok: null, error: 'blocked_private_address' }
  const cause = (err as { cause?: { code?: string } })?.cause
  const code = cause?.code ?? (err as { code?: string })?.code ?? ''
  if (HARD_FAILURE_CODES.test(code)) return { https_ok: false, error: code }
  if ((err as Error)?.name === 'TimeoutError') return { https_ok: null, error: 'timeout' }
  return { https_ok: null, error: code || 'fetch_failed' }
}

async function fetchHomepage(startUrl: string): Promise<FetchOutcome> {
  let url = startUrl
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const parsed = new URL(url)
      if (!isFetchableScheme(parsed)) {
        return { ok: false, https_ok: null, error: 'non_http_redirect' }
      }
      await assertPublicHost(parsed)

      const res = await fetch(url, {
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (!location) return { ok: false, https_ok: null, error: `redirect_without_location_${res.status}` }
        url = new URL(location, url).href
        continue
      }
      if (!res.ok) return { ok: false, https_ok: null, error: `http_${res.status}` }
      return { ok: true, html: await res.text(), finalUrl: res.url || url }
    }
    return { ok: false, https_ok: null, error: 'too_many_redirects' }
  } catch (err) {
    return { ok: false, ...classifyFetchError(err) }
  }
}

// ─── Contact-page email fallback ────────────────────────────────────────────────

// Small businesses that don't put an email on the homepage almost always list
// one on a contact page. Tried only when the homepage yielded no email — a few
// free, SSRF-guarded fetches that lift the "has a real email" rate materially
// (2026-07-10: only ~35% of prospects had a scraped email; the rest had a site
// but we only read the homepage).
const CONTACT_PATHS = ['/contact', '/contact-us', '/contact-us.html', '/about', '/about-us', '/get-a-quote', '/enquiry', '/quote']

/**
 * When the homepage exposed no email, look on a few common contact pages and
 * return the first non-empty email list found (junk already filtered by the
 * tracking detector). Free fetches, SSRF-guarded, bounded to CONTACT_PATHS.
 */
async function scrapeContactEmails(finalUrl: string): Promise<string[]> {
  let origin: string
  try { origin = new URL(finalUrl).origin } catch { return [] }
  for (const path of CONTACT_PATHS) {
    const page = await fetchHomepage(`${origin}${path}`)
    if (!page.ok) continue
    const emails = detectTrackingSignals(page.html).emails
    if (emails.length > 0) return emails
  }
  return []
}

/**
 * Standalone email discovery for a business site (homepage → contact pages),
 * junk already filtered by the tracking detector. Reused by the re-scan batch
 * (P35.11) to backfill prospects that were audited before the contact-page
 * fallback existed, or before CONTACT_PATHS widened. Never throws → [].
 */
export async function discoverContactEmail(websiteUrl: string): Promise<string[]> {
  const url = normaliseUrl(websiteUrl)
  if (!url) return []
  const page = await fetchHomepage(url)
  if (!page.ok) return []
  const homepage = detectTrackingSignals(page.html).emails
  if (homepage.length > 0) return homepage
  return scrapeContactEmails(page.finalUrl)
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the zero-AI audit for one prospect website. Never throws.
 *
 * @param websiteUrl  URL (or bare domain) from the business listing.
 */
export async function runProspectAudit(websiteUrl: string): Promise<ProspectAudit> {
  const fetched_at = new Date().toISOString()
  const empty = { fetched_at, final_url: null, tracking: null, onpage: null }

  const url = normaliseUrl(websiteUrl)
  if (!url) return { ...empty, https_ok: null, fetch_error: 'invalid_url' }

  const page = await fetchHomepage(url)
  if (!page.ok) {
    // Skip the paid OnPage call for sites we could not reach ourselves.
    return { ...empty, https_ok: page.https_ok, fetch_error: page.error }
  }

  const tracking = detectTrackingSignals(page.html)
  // Homepage had no email? Small-business emails usually live on /contact.
  if (tracking.emails.length === 0) {
    const contactEmails = await scrapeContactEmails(page.finalUrl)
    if (contactEmails.length > 0) tracking.emails = contactEmails
  }

  const onpage = await getOnPageInstant(url).catch(() => null)

  return {
    fetched_at,
    final_url:   page.finalUrl,
    https_ok:    true,
    fetch_error: null,
    tracking,
    onpage,
  }
}
