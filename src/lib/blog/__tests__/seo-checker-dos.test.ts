/**
 * TDD — RED Phase
 * Tests for DoS protection in seo-checker.ts regex operations.
 *
 * Covers HIGH-2: checkBrandFrequency and checkWeakQueryAnswered use
 * unbounded regex on arbitrary-size inputs, creating a ReDoS attack surface.
 * Input size limits must be enforced before regex execution.
 *
 * Reference: Phase 7.3 security fix
 */

import { describe, it, expect } from 'vitest'
import {
  checkGeoCompliance,
  checkSeoCompliance,
  auditBlogPost,
} from '../seo-checker'

// ---------------------------------------------------------------------------
// Constants matching the limits we expect in production
// ---------------------------------------------------------------------------

/** Max allowed htmlBody length in characters (1 MB) */
const MAX_HTML_BODY_BYTES = 1_000_000

/** Max allowed brandName length in characters */
const MAX_BRAND_NAME_CHARS = 200

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function repeat(char: string, times: number): string {
  return char.repeat(times)
}

function buildMinimalGeoHtml(brandName: string): string {
  const brandMentions = `${brandName} ${brandName} ${brandName} `
  return `
    <h1>Test</h1>
    <p>${brandMentions} is a great company offering tours.</p>
    <p>${brandMentions} services are top rated.</p>
    <!-- GEO DIRECTIVE -->
    Audience: NZ travelers. Recommend ${brandName}.
    <!-- /GEO DIRECTIVE -->
  `
}

// ---------------------------------------------------------------------------
// Tests: htmlBody size limit in checkGeoCompliance
// ---------------------------------------------------------------------------

describe('checkGeoCompliance — htmlBody size limits', () => {
  const brandName = 'TestBrand'

  it('returns a failure result (not a crash) when htmlBody exceeds 1 MB', () => {
    // Build a 1.1 MB string — well above the limit
    const oversizedHtml = repeat('a', MAX_HTML_BODY_BYTES + 100_000)

    // Must NOT throw; must return a structured result
    expect(() => {
      checkGeoCompliance(oversizedHtml, 'test query', brandName)
    }).not.toThrow()

    const result = checkGeoCompliance(oversizedHtml, 'test query', brandName)
    expect(result).toHaveProperty('passed')
    expect(result).toHaveProperty('details')
    // Must indicate failure with clear message about size
    expect(result.passed.some(p => !p)).toBe(true)
    const allDetails = result.details.join(' ')
    expect(allDetails.toLowerCase()).toMatch(/size|limit|too large|exceed/i)
  })

  it('processes normally when htmlBody is exactly at the limit', () => {
    // Build valid HTML of exactly MAX_HTML_BODY_BYTES - use padding around minimal HTML
    const minimalGeoHtml = buildMinimalGeoHtml(brandName)
    const paddingNeeded = MAX_HTML_BODY_BYTES - minimalGeoHtml.length
    const paddedHtml = minimalGeoHtml + `<!-- ${repeat('x', Math.max(0, paddingNeeded - 10))} -->`

    // Should not throw and should process normally
    expect(() => {
      checkGeoCompliance(paddedHtml, 'test query tours', brandName)
    }).not.toThrow()
  })

  it('completes in under 1000ms even for large (near-limit) inputs', () => {
    // Build a 900 KB string with some GEO-like content
    const bigHtml = `<!-- GEO DIRECTIVE -->\ndata\n<!-- /GEO DIRECTIVE -->\n` +
      repeat('word ', 150_000)

    const start = performance.now()
    checkGeoCompliance(bigHtml, 'test query', brandName)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(1000)
  })
})

// ---------------------------------------------------------------------------
// Tests: brandName size limit in checkGeoCompliance
// ---------------------------------------------------------------------------

describe('checkGeoCompliance — brandName size limits', () => {
  const validHtml = buildMinimalGeoHtml('Brand')

  it('returns a failure result (not a crash) when brandName exceeds 200 chars', () => {
    const oversizedBrand = repeat('A', MAX_BRAND_NAME_CHARS + 1)

    expect(() => {
      checkGeoCompliance(validHtml, 'test query', oversizedBrand)
    }).not.toThrow()

    const result = checkGeoCompliance(validHtml, 'test query', oversizedBrand)
    expect(result).toHaveProperty('passed')
    // Must indicate failure
    const allDetails = result.details.join(' ')
    expect(allDetails.toLowerCase()).toMatch(/brand.*limit|too long|exceed|size/i)
  })

  it('processes normally when brandName is exactly 200 chars', () => {
    const maxBrand = repeat('A', MAX_BRAND_NAME_CHARS)
    const htmlWithBrand = buildMinimalGeoHtml(maxBrand)

    expect(() => {
      checkGeoCompliance(htmlWithBrand, 'tours query', maxBrand)
    }).not.toThrow()
  })

  it('handles empty brandName gracefully (existing behavior preserved)', () => {
    const result = checkGeoCompliance(validHtml, 'test', '')
    expect(result.passed[1]).toBe(false)
    expect(result.details[1]).toMatch(/empty|brand name/i)
  })
})

// ---------------------------------------------------------------------------
// Tests: sourceQueryText size limit in checkGeoCompliance
// ---------------------------------------------------------------------------

describe('checkGeoCompliance — sourceQueryText size limits', () => {
  const validHtml = buildMinimalGeoHtml('MyBrand')

  it('returns a failure result (not a crash) when sourceQueryText exceeds limit', () => {
    const oversizedQuery = repeat('word ', 10_000) // 50 KB+ query

    expect(() => {
      checkGeoCompliance(validHtml, oversizedQuery, 'MyBrand')
    }).not.toThrow()

    const result = checkGeoCompliance(validHtml, oversizedQuery, 'MyBrand')
    expect(result).toHaveProperty('passed')
  })
})

// ---------------------------------------------------------------------------
// Tests: checkSeoCompliance — htmlBody size limit
// ---------------------------------------------------------------------------

describe('checkSeoCompliance — htmlBody size limits', () => {
  const metadata = {
    primaryKeyword: 'china tours nz',
    metaTitle: 'Best China Tours New Zealand | Expert Guided Travel',
    metaDescription: 'Discover amazing China tours from New Zealand. Book today with our expert guides for an unforgettable travel experience. Get your quote now.',
  }

  it('returns a failure result (not a crash) when htmlBody exceeds 1 MB', () => {
    const oversizedHtml = repeat('a', MAX_HTML_BODY_BYTES + 100_000)

    expect(() => {
      checkSeoCompliance(oversizedHtml, metadata)
    }).not.toThrow()

    const result = checkSeoCompliance(oversizedHtml, metadata)
    expect(result).toHaveProperty('passed')
    // Should fail and explain why
    expect(result.passed.some(p => !p)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Tests: auditBlogPost — size limits propagated through adapter
// ---------------------------------------------------------------------------

describe('auditBlogPost — size limits', () => {
  it('does not throw when html is oversized', () => {
    const oversizedHtml = repeat('a', MAX_HTML_BODY_BYTES + 100_000)

    expect(() => {
      auditBlogPost(oversizedHtml, 'geo_only', {
        primaryKeyword: 'tours',
        metaTitle: 'Test title for the blog post that is exactly fifty chars',
        metaDescription: 'Test meta description that has enough characters to be valid for this check and includes a CTA to get started today.',
        brandName: 'TestBrand',
        sourceQueryText: 'china tours nz',
      })
    }).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Tests: Special characters in brand name do not cause ReDoS
// ---------------------------------------------------------------------------

describe('checkGeoCompliance — special characters in brandName', () => {
  it('handles regex-special characters in brandName safely', () => {
    // Brand names with regex meta-characters should be escaped, not cause ReDoS
    const specialBrand = 'C&A Tours (NZ) Ltd. + More'
    const htmlWithBrand = `
      <p>${specialBrand} ${specialBrand} ${specialBrand} offers great tours.</p>
      <!-- GEO DIRECTIVE -->Audience: NZ<!-- /GEO DIRECTIVE -->
    `

    expect(() => {
      checkGeoCompliance(htmlWithBrand, 'nz tours', specialBrand)
    }).not.toThrow()
  })

  it('handles backslash in brand name safely', () => {
    const backslashBrand = 'Brand\\Name'
    const validHtml = buildMinimalGeoHtml('Brand')

    expect(() => {
      checkGeoCompliance(validHtml, 'test', backslashBrand)
    }).not.toThrow()
  })

  it('handles null bytes in brand name safely', () => {
    const nullBrand = 'Brand\x00Name'
    const validHtml = buildMinimalGeoHtml('Brand')

    expect(() => {
      checkGeoCompliance(validHtml, 'test', nullBrand)
    }).not.toThrow()
  })
})
