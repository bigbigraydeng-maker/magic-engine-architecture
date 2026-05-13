import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — declared before imports (hoisting requirement)
// ---------------------------------------------------------------------------

vi.mock('@/lib/semrush/client', () => ({
  getDomainMetrics: vi.fn(),
  getDomainOrganicKeywords: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { SeoCollector } from '../seo-collector'
import { getDomainMetrics, getDomainOrganicKeywords } from '@/lib/semrush/client'

const mockMetrics = vi.mocked(getDomainMetrics)
const mockOrganicKws = vi.mocked(getDomainOrganicKeywords)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLIENT_ID = 'client-abc'
const DOMAIN = 'example.co.nz'
const KEYWORDS = ['china tours nz', 'beijing tours', 'nz travel china']

function kwData(keyword: string) {
  return { keyword, volume: 200, kd: 25, cpc: 1.5, intent: 'commercial', trend: [] }
}

const HEALTHY_METRICS = { organic_keywords: 800, organic_traffic: 12000, authority_score: 45 }
const LOW_AUTHORITY_METRICS = { organic_keywords: 50, organic_traffic: 300, authority_score: 12 }

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockMetrics.mockResolvedValue(HEALTHY_METRICS)
  mockOrganicKws.mockResolvedValue(KEYWORDS.map(kwData))
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SeoCollector.collect()', () => {
  it('returns score between 0 and 100', async () => {
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
  })

  it('returns a findings array', async () => {
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(Array.isArray(result.findings)).toBe(true)
  })

  it('returns no keyword_gap_critical when all keywords are ranked', async () => {
    mockOrganicKws.mockResolvedValue(KEYWORDS.map(kwData))
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const gap = result.findings.find(f => f.finding_type === 'keyword_gap_critical')
    expect(gap).toBeUndefined()
  })

  it('produces keyword_gap_critical (critical) when coverage is zero', async () => {
    mockOrganicKws.mockResolvedValue([])  // domain ranks for none of our keywords
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const gap = result.findings.find(f => f.finding_type === 'keyword_gap_critical')
    expect(gap).toBeDefined()
    expect(gap?.severity).toBe('critical')
    expect(gap?.dimension).toBe('seo')
  })

  it('score is 0 when coverage=0 and authority=0', async () => {
    mockMetrics.mockResolvedValue({ organic_keywords: 0, organic_traffic: 0, authority_score: 0 })
    mockOrganicKws.mockResolvedValue([])
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBe(0)
  })

  it('produces low_domain_rank (high) when authority_score < 20', async () => {
    mockMetrics.mockResolvedValue(LOW_AUTHORITY_METRICS)
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const finding = result.findings.find(f => f.finding_type === 'low_domain_rank')
    expect(finding).toBeDefined()
    expect(finding?.severity).toBe('high')
    expect(finding?.dimension).toBe('seo')
  })

  it('does NOT produce low_domain_rank when authority_score >= 20', async () => {
    mockMetrics.mockResolvedValue({ ...HEALTHY_METRICS, authority_score: 20 })
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const finding = result.findings.find(f => f.finding_type === 'low_domain_rank')
    expect(finding).toBeUndefined()
  })

  it('returns degraded result (score=0, findings=[]) on timeout', async () => {
    // Simulate hanging API — never-resolving promise
    mockMetrics.mockReturnValue(new Promise(() => {}))
    const collector = new SeoCollector(10)   // 10 ms timeout for fast tests
    const result = await collector.collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBe(0)
    expect(result.findings).toHaveLength(0)
  })

  it('returns degraded result when external API throws', async () => {
    mockMetrics.mockRejectedValue(new Error('SEMrush 503'))
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBe(0)
    expect(result.findings).toHaveLength(0)
  })

  it('handles empty keywords list (no coverage check, no gap finding)', async () => {
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, [])
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(result.findings.find(f => f.finding_type === 'keyword_gap_critical')).toBeUndefined()
  })

  it('all findings carry client_id and fix_type', async () => {
    mockMetrics.mockResolvedValue(LOW_AUTHORITY_METRICS)
    mockOrganicKws.mockResolvedValue([])
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    for (const f of result.findings) {
      expect(f.client_id).toBe(CLIENT_ID)
      expect(['me_auto', 'fde_manual', 'third_party']).toContain(f.fix_type)
    }
  })
})
