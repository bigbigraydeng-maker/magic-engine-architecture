import {
  isDiagnosticDimension,
  isDiagnosticSeverity,
  isValidScore,
  computeOverallScore,
} from '../guards'

// ── isDiagnosticDimension ─────────────────────────────────────────────────────

describe('isDiagnosticDimension', () => {
  const valid = ['seo', 'ai_visibility', 'ads', 'social', 'reputation', 'competitor'] as const

  it.each(valid)('returns true for "%s"', (dim) => {
    expect(isDiagnosticDimension(dim)).toBe(true)
  })

  it.each([null, undefined, 42, 'unknown', '', 'SEO', 'Ads', 'AI_VISIBILITY'])(
    'returns false for %p',
    (val) => {
      expect(isDiagnosticDimension(val)).toBe(false)
    },
  )
})

// ── isDiagnosticSeverity ──────────────────────────────────────────────────────

describe('isDiagnosticSeverity', () => {
  const valid = ['critical', 'high', 'medium', 'low', 'info'] as const

  it.each(valid)('returns true for "%s"', (sev) => {
    expect(isDiagnosticSeverity(sev)).toBe(true)
  })

  it.each([null, undefined, 0, 'urgent', '', 'High', 'CRITICAL'])(
    'returns false for %p',
    (val) => {
      expect(isDiagnosticSeverity(val)).toBe(false)
    },
  )
})

// ── isValidScore ──────────────────────────────────────────────────────────────

describe('isValidScore', () => {
  it.each([0, 1, 50, 99, 100])('returns true for integer %i', (n) => {
    expect(isValidScore(n)).toBe(true)
  })

  it.each([-1, 101, 50.5, NaN, Infinity, -Infinity, '50', null, undefined, true])(
    'returns false for %p',
    (val) => {
      expect(isValidScore(val)).toBe(false)
    },
  )
})

// ── computeOverallScore ───────────────────────────────────────────────────────

describe('computeOverallScore', () => {
  it('computes weighted average across all six dimensions', () => {
    const breakdown = {
      seo: 80,           // × 0.25 = 20.0
      ai_visibility: 60, // × 0.20 = 12.0
      ads: 40,           // × 0.20 =  8.0
      social: 50,        // × 0.15 =  7.5
      reputation: 70,    // × 0.10 =  7.0
      competitor: 30,    // × 0.10 =  3.0
    }                    // sum = 57.5, totalWeight = 1.0 → Math.round(57.5) = 58
    expect(computeOverallScore(breakdown)).toBe(58)
  })

  it('re-normalises weights for partial breakdowns', () => {
    // seo=80 (w=0.25) + ai_visibility=40 (w=0.20) → 28 / 0.45 ≈ 62.22 → 62
    expect(computeOverallScore({ seo: 80, ai_visibility: 40 })).toBe(62)
  })

  it('returns 0 for empty breakdown', () => {
    expect(computeOverallScore({})).toBe(0)
  })

  it('returns 100 when all dimensions are perfect', () => {
    const breakdown = {
      seo: 100, ai_visibility: 100, reputation: 100,
      social: 100, ads: 100, competitor: 100,
    }
    expect(computeOverallScore(breakdown)).toBe(100)
  })

  it('returns 0 when all dimension scores are zero', () => {
    const breakdown = {
      seo: 0, ai_visibility: 0, reputation: 0,
      social: 0, ads: 0, competitor: 0,
    }
    expect(computeOverallScore(breakdown)).toBe(0)
  })

  it('ignores unknown dimension keys', () => {
    // cast to allow unknown key; only 'seo' (w=0.30) should count → 80/0.30*0.30 = 80
    const breakdown = { seo: 80, unknown_dim: 50 } as Parameters<typeof computeOverallScore>[0]
    expect(computeOverallScore(breakdown)).toBe(80)
  })

  it('handles single-dimension breakdown', () => {
    expect(computeOverallScore({ reputation: 55 })).toBe(55)
  })

  // P8.5.24: null dimension scores must be excluded (data unavailable)
  it('excludes null scores from weighting (re-normalises)', () => {
    // seo=80 (w=0.25), reputation=null skipped, ai_visibility=40 (w=0.20)
    // → (80*0.25 + 40*0.20) / (0.25 + 0.20) = 28 / 0.45 = 62.22 → 62
    expect(computeOverallScore({ seo: 80, reputation: null, ai_visibility: 40 })).toBe(62)
  })

  it('returns 0 when all scores are null', () => {
    expect(computeOverallScore({ seo: null, reputation: null, social: null })).toBe(0)
  })

  it('null and undefined are both excluded', () => {
    // Only seo counts → 70
    expect(computeOverallScore({ seo: 70, ai_visibility: null, ads: undefined })).toBe(70)
  })
})
