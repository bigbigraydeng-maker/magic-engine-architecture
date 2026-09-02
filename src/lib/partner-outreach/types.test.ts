import { describe, it, expect } from 'vitest'
import { assertOfficialSourced, hasAnyVerifiedPlatform, normalizeDomain, sanitizePartnerCandidate } from './types'
import type { PartnerCandidate } from './types'

function baseCandidate(overrides: Partial<PartnerCandidate> = {}): PartnerCandidate {
  return {
    company_name: 'Acme Digital', country: 'AU', website: 'https://acmedigital.com.au', domain: 'acmedigital.com.au',
    platforms: ['meta'], official_partner_status: {},
    contact_name: null, contact_role: null, contact_email: null, contact_source: null,
    b2b_partnership: 'unknown', white_label: 'unknown', support_escalation: 'unknown', training_access: 'unknown',
    event_access: 'unknown', branding_rights: 'unknown', partner_manager: null,
    commercial_model: { pricing_status: 'unknown' }, notes: null, source_urls: [],
    ...overrides,
  }
}

describe('assertOfficialSourced', () => {
  it('downgrades an unbacked "verified" claim to unknown', () => {
    const result = assertOfficialSourced({ meta: { status: 'verified' } })
    expect(result.meta?.status).toBe('unknown')
  })

  it('keeps a "verified" claim backed by a source_url', () => {
    const result = assertOfficialSourced({ meta: { status: 'verified', source_url: 'https://business.facebook.com/partners/x' } })
    expect(result.meta?.status).toBe('verified')
  })

  it('passes through unverified/unknown untouched', () => {
    const result = assertOfficialSourced({ google: { status: 'unverified' }, tiktok: { status: 'unknown' } })
    expect(result.google?.status).toBe('unverified')
    expect(result.tiktok?.status).toBe('unknown')
  })

  it('rejects a whitespace-only source_url as unbacked', () => {
    const result = assertOfficialSourced({ meta: { status: 'verified', source_url: '   ' } })
    expect(result.meta?.status).toBe('unknown')
  })
})

describe('hasAnyVerifiedPlatform', () => {
  it('false when nothing is verified', () => {
    expect(hasAnyVerifiedPlatform({ meta: { status: 'unverified' } })).toBe(false)
  })

  it('true when at least one platform is verified with a source', () => {
    expect(hasAnyVerifiedPlatform({
      meta: { status: 'unknown' },
      google: { status: 'verified', source_url: 'https://google.com/partners/x' },
    })).toBe(true)
  })
})

describe('sanitizePartnerCandidate — the mandatory choke point before persistence', () => {
  it('downgrades an unbacked "verified" claim even when the caller forgot to call assertOfficialSourced() itself', () => {
    const candidate = baseCandidate({
      official_partner_status: { meta: { status: 'verified' } }, // no source_url — e.g. a sloppy import script
    })
    const result = sanitizePartnerCandidate(candidate)
    expect(result.official_partner_status.meta?.status).toBe('unknown')
  })

  it('leaves a properly sourced "verified" claim untouched', () => {
    const candidate = baseCandidate({
      official_partner_status: { google: { status: 'verified', source_url: 'https://google.com/partners/x' } },
    })
    const result = sanitizePartnerCandidate(candidate)
    expect(result.official_partner_status.google?.status).toBe('verified')
  })

  it('does not mutate other candidate fields', () => {
    const candidate = baseCandidate({ company_name: 'Acme', platforms: ['meta', 'google'] })
    const result = sanitizePartnerCandidate(candidate)
    expect(result.company_name).toBe('Acme')
    expect(result.platforms).toEqual(['meta', 'google'])
  })
})

describe('normalizeDomain', () => {
  it('strips protocol, www, path and trailing slash', () => {
    expect(normalizeDomain('https://www.Acme.com.au/about/')).toBe('acme.com.au')
  })

  it('handles a bare domain already normalized', () => {
    expect(normalizeDomain('acme.co.nz')).toBe('acme.co.nz')
  })

  it('returns null for an empty string', () => {
    expect(normalizeDomain('  ')).toBeNull()
  })
})
