/**
 * Platform Partner Outreach — shared types.
 *
 * ME's own upstream B2B channel-partner search (Meta/Google/TikTok official
 * partners in AU/NZ), not a client-facing capability. See
 * supabase/migrations/20260902010000_platform_partner_outreach.sql for the
 * table this mirrors.
 */

export type TriState = 'yes' | 'no' | 'unknown'

export type PlatformKey = 'meta' | 'google' | 'tiktok'

export interface PlatformStatus {
  status: 'verified' | 'unverified' | 'unknown'
  /** Required whenever status === 'verified' — see assertOfficialSourced(). */
  source_url?: string
}

export type OfficialPartnerStatus = Partial<Record<PlatformKey, PlatformStatus>>

export interface CommercialModel {
  monthly_fee?: string | null
  annual_fee?: string | null
  minimum_spend?: string | null
  minimum_accounts?: string | null
  revenue_share?: string | null
  retainer?: string | null
  onboarding_fee?: string | null
  contract_length?: string | null
  /** Which case we're in — never a guessed number standing in for one of these. */
  pricing_status: 'stated' | 'contact_required' | 'unknown'
}

export interface PartnerCandidate {
  company_name: string
  country: 'AU' | 'NZ'
  website: string | null
  domain: string | null
  platforms: PlatformKey[]
  official_partner_status: OfficialPartnerStatus
  contact_name: string | null
  contact_role: string | null
  contact_email: string | null
  contact_source: string | null
  b2b_partnership: TriState
  white_label: TriState
  support_escalation: TriState
  training_access: TriState
  event_access: TriState
  branding_rights: TriState
  partner_manager: string | null
  commercial_model: CommercialModel
  notes: string | null
  source_urls: string[]
}

/**
 * Anti-fabrication guard (魏征 review 2026-09-02): a platform status can only
 * be 'verified' when a source_url backs it — self-reported claims ("we are a
 * leading Meta agency") are not evidence. Downgrades any unbacked 'verified'
 * claim to 'unknown' rather than trusting the caller.
 *
 * Scope, precisely (Codex review 2026-09-02): this only checks that
 * source_url is a non-empty string — it does NOT verify the URL is on an
 * official platform domain. That's deliberate: spec's own evidence tiers
 * (§6) accept "a company's own qualification page displaying the real
 * program badge" as valid, not only the official directory itself, and a
 * fixed domain allowlist would reject that legitimate tier. The research
 * step is responsible for only ever putting a real, checkable page in
 * source_url — this function's guarantee is narrower: "no URL → never
 * verified", not "the URL proves official status."
 *
 * This function does nothing on its own if nothing calls it — pass every
 * candidate through sanitizePartnerCandidate() before it's written anywhere
 * (DB insert, draft generation) rather than relying on the caller to
 * remember to call assertOfficialSourced() directly.
 */
export function assertOfficialSourced(input: OfficialPartnerStatus): OfficialPartnerStatus {
  const result: OfficialPartnerStatus = {}
  for (const key of Object.keys(input) as PlatformKey[]) {
    const entry = input[key]
    if (!entry) continue
    result[key] = entry.status === 'verified' && !entry.source_url?.trim()
      ? { status: 'unknown' }
      : entry
  }
  return result
}

/**
 * The mandatory choke point before a candidate is persisted or drafted:
 * runs official_partner_status through assertOfficialSourced() so an
 * unbacked 'verified' claim can never reach the database, regardless of
 * where the candidate came from (AI research, manual entry, a future
 * import script). Call this, not assertOfficialSourced() directly, from
 * any write path.
 */
export function sanitizePartnerCandidate(candidate: PartnerCandidate): PartnerCandidate {
  return {
    ...candidate,
    official_partner_status: assertOfficialSourced(candidate.official_partner_status),
  }
}

/** True once the candidate has ≥1 platform verified via an official source. */
export function hasAnyVerifiedPlatform(status: OfficialPartnerStatus): boolean {
  return Object.values(status).some(s => s?.status === 'verified' && !!s.source_url?.trim())
}

/** lowercase, strip protocol/www/path/trailing slash — the dedup key. */
export function normalizeDomain(websiteOrDomain: string): string | null {
  const trimmed = websiteOrDomain.trim()
  if (!trimmed) return null
  const withoutProtocol = trimmed.replace(/^https?:\/\//i, '')
  const host = withoutProtocol.split('/')[0].toLowerCase()
  const withoutWww = host.replace(/^www\./, '')
  return withoutWww || null
}
