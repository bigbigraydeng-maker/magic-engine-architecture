/**
 * Tests for the CTS verifier policy (Issue #1579).
 *
 * Every negative case here asserts the actual `verifyCtsReply(...).ok` result
 * (and, where it matters, which gate fired) — not that some internal function
 * was merely called. A gate that is wired up but never actually blocks
 * anything is exactly the kind of "declared but not wired" gap this suite
 * exists to catch (see MEMORY feedback-declared-but-not-wired).
 */

import { describe, expect, it } from 'vitest'
import type { OfferingsFile } from '../../offerings-loader'
import { CTS_CLIENT_ID, verifyCtsReply, type CtsVerifierContext } from '../policies/cts'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CANONICAL: OfferingsFile = {
  active_tours: [
    {
      code: 'golden-china',
      name: 'China Discovery — Golden China',
      aliases: ['Golden China'],
      price_nzd: 4999,
      departure_dates: ['2026-11-16'],
      nights: 9,
      itinerary_url: 'https://www.ctstours.co.nz/tours/china/discovery/golden-china',
      highlights: ['Great Wall', 'Terracotta Warriors'],
    },
    {
      code: 'christmas-tour-akl',
      name: 'Christmas Tour — Auckland Departure',
      aliases: ['Auckland Christmas Tour'],
      price_nzd: 7188,
      departure_dates: ['2026-12-20'],
      nights: 16,
      itinerary_url: 'https://tours.example-partner.co.nz/christmas-akl',
      highlights: [],
    },
  ],
  retired_tours: [
    {
      code: 'silk-road-discovery',
      name: 'Silk Road Discovery',
      aliases: ['Silk Road'],
      retired_reason: 'PM plan marks this retired.',
      still_visible_on_website: true,
    },
  ],
  factual_bullets: ['CTS Tours NZ has operated in New Zealand for 25 years.'],
  reply_forbidden_topics: [
    'Refund or compensation decisions',
    'Visa outcome guarantees',
  ],
  last_verified_at: '2026-09-13T00:00:00+13:00',
}

const BRAND_REDLINES = ['100% guaranteed', 'no risk at all', 'cheapest in NZ']

function baseContext(overrides: Partial<CtsVerifierContext> = {}): CtsVerifierContext {
  return {
    clientId: CTS_CLIENT_ID,
    agentOutput: {
      reply_text:
        'Kia ora! The Golden China tour departs 2026-11-16 and costs $4999. ' +
        'Itinerary: https://www.ctstours.co.nz/tours/china/discovery/golden-china',
      confidence: 0.9,
      offerings: [{ name: 'Golden China', code: 'golden-china' }],
    },
    brandRedlinePhrases: BRAND_REDLINES,
    canonical: CANONICAL,
    ...overrides,
  }
}

// ─── Happy path ──────────────────────────────────────────────────────────────

describe('verifyCtsReply — valid draft', () => {
  it('passes all seven gates', () => {
    const result = verifyCtsReply(baseContext())
    expect(result).toEqual({ ok: true, blocked_reasons: [], require_human_confirm: true })
  })
})

// ─── Gate 1: Brand redline ───────────────────────────────────────────────────

describe('Gate 1 — brand redline', () => {
  it.each(BRAND_REDLINES)('blocks a reply containing redline phrase "%s"', (phrase) => {
    const result = verifyCtsReply(
      baseContext({
        agentOutput: {
          reply_text: `This tour is ${phrase}, book now!`,
          confidence: 0.9,
          offerings: [],
        },
      })
    )
    expect(result.ok).toBe(false)
    expect(result.blocked_reasons.some((r) => r.startsWith('brand_redline:'))).toBe(true)
    expect(result.require_human_confirm).toBe(true)
  })

  it('does not block a clean reply mentioning none of the redline phrases', () => {
    const result = verifyCtsReply(
      baseContext({
        agentOutput: { reply_text: 'Thanks for your interest in our tours!', confidence: 0.9, offerings: [] },
      })
    )
    expect(result.blocked_reasons.some((r) => r.startsWith('brand_redline:'))).toBe(false)
  })
})

// ─── Gate 2: Retired tour mention ───────────────────────────────────────────

describe('Gate 2 — retired tour mention', () => {
  const retiredMentions = [
    'The Silk Road Discovery tour is available in March.',
    'Yes, Silk Road is one of our most popular routes!',
    'silk road discovery still has spots left.',
  ]

  it.each(retiredMentions)('blocks reply text: "%s"', (text) => {
    const result = verifyCtsReply(
      baseContext({ agentOutput: { reply_text: text, confidence: 0.9, offerings: [] } })
    )
    expect(result.ok).toBe(false)
    expect(result.blocked_reasons.some((r) => r.startsWith('retired_tour_mention:'))).toBe(true)
  })

  it('does not block a reply that never mentions any retired tour', () => {
    const result = verifyCtsReply(baseContext())
    expect(result.blocked_reasons.some((r) => r.startsWith('retired_tour_mention:'))).toBe(false)
  })
})

// ─── Gate 3: Number claim ────────────────────────────────────────────────────

describe('Gate 3 — number claim (price/date must be verifiable)', () => {
  it('blocks a price that matches no active tour', () => {
    const result = verifyCtsReply(
      baseContext({
        agentOutput: { reply_text: 'The Golden China tour costs $5,500.', confidence: 0.9, offerings: [] },
      })
    )
    expect(result.ok).toBe(false)
    expect(result.blocked_reasons.some((r) => r.startsWith('number_claim:') && r.includes('5500'))).toBe(
      true
    )
  })

  it('blocks a departure date that matches no active tour', () => {
    const result = verifyCtsReply(
      baseContext({
        agentOutput: { reply_text: 'Departure is on 2027-01-01.', confidence: 0.9, offerings: [] },
      })
    )
    expect(result.ok).toBe(false)
    expect(
      result.blocked_reasons.some((r) => r.startsWith('number_claim:') && r.includes('2027-01-01'))
    ).toBe(true)
  })

  it('blocks when both price and date are fabricated (still one gate, reports the first mismatch)', () => {
    const result = verifyCtsReply(
      baseContext({
        agentOutput: {
          reply_text: 'Special deal: $999 departing 2099-12-31!',
          confidence: 0.9,
          offerings: [],
        },
      })
    )
    expect(result.ok).toBe(false)
    expect(result.blocked_reasons.some((r) => r.startsWith('number_claim:'))).toBe(true)
  })

  it('does not block a price and date that both match an active tour', () => {
    const result = verifyCtsReply(
      baseContext({
        agentOutput: {
          reply_text: 'The Christmas Tour departs 2026-12-20 and costs $7188.',
          confidence: 0.9,
          offerings: [],
        },
      })
    )
    expect(result.blocked_reasons.some((r) => r.startsWith('number_claim:'))).toBe(false)
  })
})

// ─── Gate 4: Reply forbidden topics ─────────────────────────────────────────

describe('Gate 4 — reply forbidden topics', () => {
  const forbiddenReplies = [
    'Yes, we can process your refund or compensation decisions right away.',
    'I can confirm a visa outcome guarantees for your application.',
    'Regarding Refund or compensation decisions — absolutely, no problem.',
  ]

  it.each(forbiddenReplies)('blocks reply text: "%s"', (text) => {
    const result = verifyCtsReply(
      baseContext({ agentOutput: { reply_text: text, confidence: 0.9, offerings: [] } })
    )
    expect(result.ok).toBe(false)
    expect(result.blocked_reasons.some((r) => r.startsWith('reply_forbidden_topic:'))).toBe(true)
  })

  it('does not block a reply that avoids forbidden topics', () => {
    const result = verifyCtsReply(baseContext())
    expect(result.blocked_reasons.some((r) => r.startsWith('reply_forbidden_topic:'))).toBe(false)
  })
})

// ─── Gate 5: Provenance (name↔code one-to-one) ──────────────────────────────

describe('Gate 5 — provenance one-to-one mapping', () => {
  it('BLOCKS the exact attack this gate exists for: real tour name + fabricated code', () => {
    const result = verifyCtsReply(
      baseContext({
        agentOutput: {
          reply_text: 'The Golden China tour is a great choice.',
          confidence: 0.9,
          offerings: [{ name: 'Golden China', code: 'not-a-real-code' }],
        },
      })
    )
    expect(result.ok).toBe(false)
    expect(
      result.blocked_reasons.some(
        (r) => r.startsWith('provenance:') && r.includes('not-a-real-code')
      )
    ).toBe(true)
  })

  it('blocks a name that resolves to a DIFFERENT real tour\'s code (cross-tour swap)', () => {
    const result = verifyCtsReply(
      baseContext({
        agentOutput: {
          reply_text: 'The Golden China tour is a great choice.',
          // "Golden China" really is golden-china, not christmas-tour-akl.
          offerings: [{ name: 'Golden China', code: 'christmas-tour-akl' }],
          confidence: 0.9,
        },
      })
    )
    expect(result.ok).toBe(false)
    expect(result.blocked_reasons.some((r) => r.startsWith('provenance:'))).toBe(true)
  })

  it('blocks an offering name that matches no active tour name or alias at all', () => {
    const result = verifyCtsReply(
      baseContext({
        agentOutput: {
          reply_text: 'The Grand Safari tour is a great choice.',
          confidence: 0.9,
          offerings: [{ name: 'Grand Safari', code: 'grand-safari' }],
        },
      })
    )
    expect(result.ok).toBe(false)
    expect(result.blocked_reasons.some((r) => r.startsWith('provenance:'))).toBe(true)
  })

  it('passes when name (via alias) and code correctly correspond to the same tour', () => {
    const result = verifyCtsReply(
      baseContext({
        agentOutput: {
          reply_text: 'The Auckland Christmas Tour is a great choice.',
          confidence: 0.9,
          offerings: [{ name: 'Auckland Christmas Tour', code: 'christmas-tour-akl' }],
        },
      })
    )
    expect(result.blocked_reasons.some((r) => r.startsWith('provenance:'))).toBe(false)
  })
})

// ─── Gate 6: Length ──────────────────────────────────────────────────────────

describe('Gate 6 — length (<= 1800, stricter of the two channels)', () => {
  function withLength(len: number): CtsVerifierContext {
    return baseContext({
      agentOutput: { reply_text: 'a'.repeat(len), confidence: 0.9, offerings: [] },
    })
  }

  it('1799 chars passes', () => {
    const result = verifyCtsReply(withLength(1799))
    expect(result.blocked_reasons.some((r) => r.startsWith('length:'))).toBe(false)
  })

  it('1800 chars passes (boundary is inclusive, <=)', () => {
    const result = verifyCtsReply(withLength(1800))
    expect(result.blocked_reasons.some((r) => r.startsWith('length:'))).toBe(false)
  })

  it('1801 chars is blocked', () => {
    const result = verifyCtsReply(withLength(1801))
    expect(result.ok).toBe(false)
    expect(result.blocked_reasons.some((r) => r.startsWith('length:'))).toBe(true)
  })
})

// ─── Gate 7: URL allowlist ───────────────────────────────────────────────────

describe('Gate 7 — URL allowlist', () => {
  it('blocks a URL to a host with no relationship to CTS at all', () => {
    const result = verifyCtsReply(
      baseContext({
        agentOutput: {
          reply_text: 'Check out this deal: https://evil-scam-deals.example.com/promo',
          confidence: 0.9,
          offerings: [],
        },
      })
    )
    expect(result.ok).toBe(false)
    expect(result.blocked_reasons.some((r) => r.startsWith('url_allowlist:'))).toBe(true)
  })

  it('blocks a bare google.com URL that is not a Maps link', () => {
    const result = verifyCtsReply(
      baseContext({
        agentOutput: {
          reply_text: 'Search here: https://google.com/search?q=cts+tours',
          confidence: 0.9,
          offerings: [],
        },
      })
    )
    expect(result.ok).toBe(false)
    expect(result.blocked_reasons.some((r) => r.startsWith('url_allowlist:'))).toBe(true)
  })

  it('blocks a lookalike domain impersonating ctstours.co.nz', () => {
    const result = verifyCtsReply(
      baseContext({
        agentOutput: {
          reply_text: 'Book here: https://ctstours.co.nz.evil-phish.com/login',
          confidence: 0.9,
          offerings: [],
        },
      })
    )
    expect(result.ok).toBe(false)
    expect(result.blocked_reasons.some((r) => r.startsWith('url_allowlist:'))).toBe(true)
  })

  it('allows ctstours.co.nz, google.com/maps, immigration.govt.nz, and an active tour itinerary host', () => {
    const result = verifyCtsReply(
      baseContext({
        agentOutput: {
          reply_text:
            'See https://www.ctstours.co.nz/tours/china, ' +
            'https://google.com/maps?q=auckland, ' +
            'https://www.immigration.govt.nz/visas, and ' +
            'https://tours.example-partner.co.nz/christmas-akl',
          confidence: 0.9,
          offerings: [],
        },
      })
    )
    expect(result.blocked_reasons.some((r) => r.startsWith('url_allowlist:'))).toBe(false)
  })

  it('allows a maps.google.com share link on any path', () => {
    const result = verifyCtsReply(
      baseContext({
        agentOutput: {
          reply_text: 'Here is the meeting point: https://maps.google.com/maps/place/somewhere',
          confidence: 0.9,
          offerings: [],
        },
      })
    )
    expect(result.blocked_reasons.some((r) => r.startsWith('url_allowlist:'))).toBe(false)
  })
})

// ─── Cross-client guard ──────────────────────────────────────────────────────

describe('Cross-client guard', () => {
  it('aborts with a mismatch reason when CTS policy is fed another client\'s conversation data', () => {
    const otherClientContext = baseContext({
      clientId: 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84', // Oztop — a real, different client id (CLAUDE.md)
    })

    const result = verifyCtsReply(otherClientContext)

    expect(result.ok).toBe(false)
    expect(result.blocked_reasons).toHaveLength(1)
    expect(result.blocked_reasons[0]).toContain('client_id_mismatch')
    expect(result.require_human_confirm).toBe(true)
  })
})

// ─── Multiple simultaneous failures ─────────────────────────────────────────

describe('Multiple gates firing at once', () => {
  it('collects every blocked gate, not just the first', () => {
    const result = verifyCtsReply(
      baseContext({
        agentOutput: {
          reply_text: `This is 100% guaranteed! Silk Road Discovery costs $999 departing 2099-01-01. Visit https://evil.example.com/`,
          confidence: 0.9,
          offerings: [{ name: 'Golden China', code: 'wrong-code' }],
        },
      })
    )
    expect(result.ok).toBe(false)
    const firedGates = result.blocked_reasons.map((r) => r.split(':')[0])
    expect(firedGates).toEqual(
      expect.arrayContaining([
        'brand_redline',
        'retired_tour_mention',
        'number_claim',
        'provenance',
        'url_allowlist',
      ])
    )
  })
})
