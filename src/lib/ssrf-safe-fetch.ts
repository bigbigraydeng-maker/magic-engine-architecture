/**
 * ssrf-safe-fetch — shared SSRF guard primitives for any code that fetches a
 * URL supplied by an untrusted source (a prospect's website, a client's
 * sitemap, …). Extracted from src/lib/prospecting/audit.ts (Codex review on
 * PR #963) so prospecting/audit.ts and site-audit/crawler.ts call the exact
 * same private-address rule instead of each maintaining its own copy that
 * could quietly drift apart.
 *
 * 🔴 Deliberately does NOT own a "fetch with redirects" loop. Each caller has
 *    a different terminal-condition/error taxonomy (audit.ts's ProspectAudit
 *    error strings vs. crawler.ts's onIssue reports) — folding both into one
 *    generic loop risks changing prospect-audit's existing behavior just to
 *    make the loop reusable. What genuinely doesn't vary between callers is
 *    "is this hostname/IP safe to contact" and "is this scheme fetchable" —
 *    those two checks live here; each caller still runs its own manual
 *    redirect loop, calling assertPublicHost() again on every hop.
 *
 * Note: this module already has an unrelated pre-existing counterpart at
 * src/lib/cms/ssrf-guard.ts (and format-only siblings shopify-guard.ts /
 * url-guard.ts) for CMS connector URLs. Consolidating those is out of scope
 * here — this file only unifies the two call sites this PR touches
 * (prospecting/audit.ts and site-audit/crawler.ts).
 */

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

function isPrivateIpV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||   // CGNAT
    (a === 169 && b === 254) ||             // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
}

/** Exported for tests. */
export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIpV4(ip)
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (v6 === '::' || v6 === '::1') return true
  if (v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9')) return true
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  return mapped ? isPrivateIpV4(mapped[1]) : false
}

/** Only http/https are fetchable — file:, data:, ftp:, etc. must never reach fetch(). */
export function isFetchableScheme(url: URL): boolean {
  return /^https?:$/.test(url.protocol)
}

export class BlockedAddressError extends Error {
  constructor(public readonly host: string) { super(`blocked private address: ${host}`) }
}

/**
 * Throws BlockedAddressError when the URL's host is (or resolves to) a
 * private / loopback / link-local / CGNAT / cloud-metadata address.
 * DNS lookup failures are NOT caught here — they propagate to the caller so
 * each caller keeps its own classification for "couldn't resolve" vs.
 * "resolved to something blocked" (they are different failure modes).
 */
export async function assertPublicHost(url: URL): Promise<void> {
  // URL.hostname keeps the brackets for an IPv6 literal (e.g. "[::1]"), but
  // net.isIP() only recognises the bare form — strip them before checking,
  // otherwise every IPv6-literal URL falls through to the DNS-lookup branch
  // below and gets misreported as "unreachable" instead of "blocked".
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new BlockedAddressError(host)
    return
  }
  const { address } = await lookup(host)
  if (isPrivateIp(address)) throw new BlockedAddressError(host)
}
