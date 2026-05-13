import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures variables are available at factory time
// ---------------------------------------------------------------------------

const { mockGetBusinessReviews } = vi.hoisted(() => ({
  mockGetBusinessReviews: vi.fn(),
}))

vi.mock('@/lib/places/client', () => ({
  getBusinessReviews: mockGetBusinessReviews,
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { ReputationCollector } from '../reputation-collector'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLIENT_ID = 'client-rep-test'
const DOMAIN = 'example.co.nz'
const KEYWORDS: string[] = []

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Happy path — high score
// ---------------------------------------------------------------------------

describe('ReputationCollector.collect() — strong reputation', () => {
  it('returns score >= 80 for rating=4.8 and 250 reviews', async () => {
    mockGetBusinessReviews.mockResolvedValue({
      placeId: 'abc123',
      name: 'Example Business',
      rating: 4.8,
      totalReviews: 250,
    })
    const { score } = await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(score).toBeGreaterThanOrEqual(80)
  })

  it('returns no findings for an excellent profile', async () => {
    mockGetBusinessReviews.mockResolvedValue({
      placeId: 'abc123',
      name: 'Example Business',
      rating: 4.8,
      totalReviews: 250,
    })
    const { findings } = await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(findings).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Low rating
// ---------------------------------------------------------------------------

describe('ReputationCollector.collect() — low rating', () => {
  it('returns score < 40 for rating=3.2 and 8 reviews', async () => {
    mockGetBusinessReviews.mockResolvedValue({
      placeId: 'abc123',
      name: 'Example Business',
      rating: 3.2,
      totalReviews: 8,
    })
    const { score } = await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(score).toBeLessThan(40)
  })

  it('emits low_review_rating (high) when rating < 3.5', async () => {
    mockGetBusinessReviews.mockResolvedValue({
      placeId: 'abc123',
      name: 'Example Business',
      rating: 3.2,
      totalReviews: 50,
    })
    const { findings } = await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const f = findings.find(x => x.finding_type === 'low_review_rating')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('high')
  })

  it('does NOT emit low_review_rating when rating >= 3.5', async () => {
    mockGetBusinessReviews.mockResolvedValue({
      placeId: 'abc123',
      name: 'Example Business',
      rating: 4.0,
      totalReviews: 100,
    })
    const { findings } = await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(findings.find(x => x.finding_type === 'low_review_rating')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Few reviews
// ---------------------------------------------------------------------------

describe('ReputationCollector.collect() — few reviews', () => {
  it('emits insufficient_review_count (medium) when reviews <= 5', async () => {
    mockGetBusinessReviews.mockResolvedValue({
      placeId: 'abc123',
      name: 'Example Business',
      rating: 4.5,
      totalReviews: 5,
    })
    const { findings } = await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const f = findings.find(x => x.finding_type === 'insufficient_review_count')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('medium')
  })

  it('does NOT emit insufficient_review_count when reviews > 20', async () => {
    mockGetBusinessReviews.mockResolvedValue({
      placeId: 'abc123',
      name: 'Example Business',
      rating: 4.0,
      totalReviews: 50,
    })
    const { findings } = await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(findings.find(x => x.finding_type === 'insufficient_review_count')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// No review platform
// ---------------------------------------------------------------------------

describe('ReputationCollector.collect() — no review platform', () => {
  it('returns score=null and business_not_listed finding when Places returns null', async () => {
    // P8.5.20: business not on Google → score is unknowable, dimension is skipped
    mockGetBusinessReviews.mockResolvedValue(null)
    const { score, findings } = await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(score).toBeNull()
    expect(findings.find(x => x.finding_type === 'business_not_listed')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// API timeout / degraded
// ---------------------------------------------------------------------------

describe('ReputationCollector.collect() — failure', () => {
  it('returns degraded { score: null, findings: [] } when API throws', async () => {
    mockGetBusinessReviews.mockRejectedValue(new Error('Places timeout'))
    const result = await new ReputationCollector(10).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBeNull()
    expect(result.findings).toHaveLength(0)
  })

  it('returns degraded result on timeout', async () => {
    mockGetBusinessReviews.mockReturnValue(new Promise(() => {}))  // never resolves
    const result = await new ReputationCollector(10).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBeNull()
    expect(result.findings).toHaveLength(0)
  })
})
