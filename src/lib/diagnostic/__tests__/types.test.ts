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
      seo: 80,           // × 0.30 = 24.0
      ai_visibility: 60, // × 0.25 = 15.0
      reputation: 70,    // × 0.20 = 14.0
      social: 50,        // × 0.10 =  5.0
      ads: 40,           // × 0.10 =  4.0
      competitor: 30,    // × 0.05 =  1.5
    }                    // sum = 63.5, totalWeight = 1.0 → Math.round(63.5) = 64
    expect(computeOverallScore(breakdown)).toBe(64)
  })

  it('re-normalises weights for partial breakdowns', () => {
    // seo=80 (w=0.30) + ai_visibility=40 (w=0.25) → 34 / 0.55 ≈ 61.82 → 62
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
})
