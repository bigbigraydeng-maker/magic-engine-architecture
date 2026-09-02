import { describe, it, expect } from 'vitest'
import { calculatePartnerFitScore } from './score'
import type { PartnerCandidate } from './types'

function baseCandidate(overrides: Partial<PartnerCandidate> = {}): PartnerCandidate {
  return {
    company_name: 'Acme Digital',
    country: 'AU',
    website: 'https://acmedigital.com.au',
    domain: 'acmedigital.com.au',
    platforms: ['google'],
    official_partner_status: {},
    contact_name: null,
    contact_role: null,
    contact_email: null,
    contact_source: null,
    b2b_partnership: 'unknown',
    white_label: 'unknown',
    support_escalation: 'unknown',
    training_access: 'unknown',
    event_access: 'unknown',
    branding_rights: 'unknown',
    partner_manager: null,
    commercial_model: { pricing_status: 'unknown' },
    notes: null,
    source_urls: [],
    ...overrides,
  }
}

describe('calculatePartnerFitScore', () => {
  it('scores an all-unknown candidate at 0 (no free credit for unverified claims)', () => {
    const result = calculatePartnerFitScore(baseCandidate({ platforms: [] }))
    expect(result.score).toBe(0)
    expect(result.priority).toBe('none')
  })

  it('does NOT credit official_platform_status without a source_url — the anti-fabrication rule', () => {
    const withUnbackedClaim = baseCandidate({
      official_partner_status: { google: { status: 'verified' } }, // no source_url
    })
    const result = calculatePartnerFitScore(withUnbackedClaim)
    const signal = result.breakdown.find(b => b.signal === 'official_platform_status')
    expect(signal?.points).toBe(0)
  })

  it('credits official_platform_status once verified with a source_url', () => {
    const verified = baseCandidate({
      official_partner_status: { google: { status: 'verified', source_url: 'https://google.com/partners/acme' } },
    })
    const result = calculatePartnerFitScore(verified)
    const signal = result.breakdown.find(b => b.signal === 'official_platform_status')
    expect(signal?.points).toBe(20)
  })

  it('reaches Priority A only when the strongest signals are all yes/verified', () => {
    const strong = baseCandidate({
      platforms: ['meta', 'google', 'tiktok'],
      official_partner_status: { meta: { status: 'verified', source_url: 'https://business.facebook.com/partners/acme' } },
      support_escalation: 'yes',
      training_access: 'yes',
      b2b_partnership: 'yes',
      branding_rights: 'yes',
      notes: 'Sydney, AU head office',
      commercial_model: { pricing_status: 'stated' },
    })
    const result = calculatePartnerFitScore(strong)
    expect(result.score).toBe(100)
    expect(result.priority).toBe('A')
  })

  it('gives partial credit for multi-platform capability proportional to platform count', () => {
    const one = calculatePartnerFitScore(baseCandidate({ platforms: ['meta'] }))
    const three = calculatePartnerFitScore(baseCandidate({ platforms: ['meta', 'google', 'tiktok'] }))
    const oneSignal = one.breakdown.find(b => b.signal === 'multi_platform_capability')!.points
    const threeSignal = three.breakdown.find(b => b.signal === 'multi_platform_capability')!.points
    expect(threeSignal).toBeGreaterThan(oneSignal)
    expect(threeSignal).toBe(5)
  })

  it('priority bands match the spec thresholds (80/65/50)', () => {
    expect(calculatePartnerFitScore(baseCandidate()).priority).toBe('none')
    // Force exact boundary scores via breakdown-summing signals.
    const bandB = baseCandidate({
      official_partner_status: { google: { status: 'verified', source_url: 'https://x' } }, // 20
      support_escalation: 'yes', // 25
      training_access: 'yes', // 15
      b2b_partnership: 'yes', // 15
      platforms: ['google'],
    })
    // 20 (official status) + 25 (escalation) + 15 (training) + 15 (b2b) +
    // 2 (multi-platform, single platform rounds to 5*1/3) = 77.
    expect(calculatePartnerFitScore(bandB).score).toBe(77)
    expect(calculatePartnerFitScore(bandB).priority).toBe('B')
  })
})
