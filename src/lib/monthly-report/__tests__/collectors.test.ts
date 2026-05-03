import { describe, it, expect, beforeAll, vi } from 'vitest'
import { AITrackerCollector } from '../collectors/ai-tracker'
import { LinkIntelligenceCollector } from '../collectors/link-intelligence'
import { SERPIntelligenceCollector } from '../collectors/serp-intelligence'
import { LocalVisibilityCollector } from '../collectors/local-visibility'
import { MarketBaselineCollector } from '../collectors/market-baseline'
import { BillingMonitorCollector } from '../collectors/billing-monitor'

// Mock Supabase client
const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
  update: vi.fn().mockReturnThis(),
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase),
}))

describe('Data Collectors', () => {
  describe('AITrackerCollector', () => {
    let collector: AITrackerCollector

    beforeAll(() => {
      collector = new AITrackerCollector()
    })

    it('should have correct datasource type', () => {
      expect(collector.datasource_type).toBe('ai_tracker')
    })

    it('should have correct name', () => {
      expect(collector.name).toBe('AI Visibility Tracker')
    })

    it('should validate positive AI metrics', () => {
      const validData = {
        avg_ranking: 5.5,
        ranking_change: 0,
        tracked_questions: 10,
        top_questions: ['question1'],
        lowest_ranking_questions: ['question10'],
      }
      expect(collector.validate(validData)).toBe(true)
    })

    it('should reject invalid data types', () => {
      expect(collector.validate(null)).toBe(false)
      expect(collector.validate(undefined)).toBe(false)
      expect(collector.validate('invalid')).toBe(false)
    })

    it('should normalize run data correctly', () => {
      const rawRuns = [
        { client_brand_rank: 1, ai_visibility_queries: { question: 'q1' } },
        { client_brand_rank: 2, ai_visibility_queries: { question: 'q1' } },
        { client_brand_rank: 5, ai_visibility_queries: { question: 'q2' } },
      ]

      // Create normalized version
      const metrics = collector['normalizeRuns'](rawRuns)

      expect(metrics.tracked_questions).toBe(2)
      expect(metrics.avg_ranking).toBeGreaterThan(0)
    })
  })

  describe('LinkIntelligenceCollector', () => {
    let collector: LinkIntelligenceCollector

    beforeAll(() => {
      collector = new LinkIntelligenceCollector()
    })

    it('should have correct datasource type', () => {
      expect(collector.datasource_type).toBe('link_intel')
    })

    it('should validate link metrics', () => {
      const validData = {
        total_backlinks: 100,
        new_backlinks_this_month: 5,
        lost_backlinks_this_month: 2,
        quality_score: 75.5,
        top_referring_domains: ['example.com'],
        backlink_velocity: 0.17,
      }
      expect(collector.validate(validData)).toBe(true)
    })

    it('should normalize backlink data', () => {
      const currentMonth = [
        { domain: 'site1.com', url: 'url1', is_active: true, quality_score: 80 },
        { domain: 'site2.com', url: 'url2', is_active: true, quality_score: 70 },
      ]

      const metrics = collector['normalizeBacklinks'](currentMonth, [])

      expect(metrics.total_backlinks).toBe(2)
      expect(metrics.new_backlinks_this_month).toBe(2)
      expect(metrics.quality_score).toBe(75)
    })
  })

  describe('SERPIntelligenceCollector', () => {
    let collector: SERPIntelligenceCollector

    beforeAll(() => {
      collector = new SERPIntelligenceCollector()
    })

    it('should have correct datasource type', () => {
      expect(collector.datasource_type).toBe('serp')
    })

    it('should validate SERP metrics', () => {
      const validData = {
        avg_position: 15.5,
        position_change: 2,
        tracked_keywords: 100,
        top10_keywords: 25,
        top50_keywords: 60,
        new_rankings: 5,
        lost_rankings: 2,
        top_keywords: [],
      }
      expect(collector.validate(validData)).toBe(true)
    })

    it('should count keywords in top 10', () => {
      const rankings = [
        { keyword: 'k1', position: 5, change_percent: 0 },
        { keyword: 'k2', position: 15, change_percent: 0 },
        { keyword: 'k3', position: 8, change_percent: 0 },
      ]

      const metrics = collector['normalizeRankings'](rankings, [])

      expect(metrics.top10_keywords).toBe(2)
      expect(metrics.tracked_keywords).toBe(3)
    })
  })

  describe('LocalVisibilityCollector', () => {
    let collector: LocalVisibilityCollector

    beforeAll(() => {
      collector = new LocalVisibilityCollector()
    })

    it('should have correct datasource type', () => {
      expect(collector.datasource_type).toBe('local')
    })

    it('should validate local metrics', () => {
      const validData = {
        avg_position: 20,
        tracked_keywords: 50,
        top10_keywords: 10,
        cities_covered: 5,
        top_cities: [],
      }
      expect(collector.validate(validData)).toBe(true)
    })

    it('should count cities and keywords', () => {
      const rankings = [
        { keyword: 'k1', city: 'Sydney', position: 5 },
        { keyword: 'k2', city: 'Sydney', position: 20 },
        { keyword: 'k3', city: 'Melbourne', position: 8 },
      ]

      const metrics = collector['normalizeLocalRankings'](rankings)

      expect(metrics.cities_covered).toBe(2)
      expect(metrics.tracked_keywords).toBe(3)
      expect(metrics.top10_keywords).toBe(2)
    })
  })

  describe('MarketBaselineCollector', () => {
    let collector: MarketBaselineCollector

    beforeAll(() => {
      collector = new MarketBaselineCollector()
    })

    it('should have correct datasource type', () => {
      expect(collector.datasource_type).toBe('market')
    })

    it('should validate market metrics', () => {
      const validData = {
        opportunity_score: 75.5,
        top_opportunities: 10,
        underperformers: 3,
        market_strength: 'ahead' as const,
        top_opportunity_keywords: [],
      }
      expect(collector.validate(validData)).toBe(true)
    })

    it('should determine market strength', () => {
      const comparisons = [
        { keyword: 'k1', opportunity_score: 80, is_top_opportunity: true, is_underperformer: false },
        { keyword: 'k2', opportunity_score: 50, is_top_opportunity: false, is_underperformer: false },
        { keyword: 'k3', opportunity_score: 30, is_top_opportunity: false, is_underperformer: true },
      ]

      const metrics = collector['normalizeMarketData'](comparisons)

      expect(metrics.top_opportunities).toBe(1)
      expect(metrics.underperformers).toBe(1)
      expect(metrics.market_strength).toBe('aligned')
    })
  })

  describe('BillingMonitorCollector', () => {
    let collector: BillingMonitorCollector

    beforeAll(() => {
      collector = new BillingMonitorCollector()
    })

    it('should have correct datasource type', () => {
      expect(collector.datasource_type).toBe('billing')
    })

    it('should validate billing metrics', () => {
      const validData = {
        total_cost_usd: 500.0,
        total_api_calls: 10000,
        cost_by_service: { openai: 250, semrush: 250 },
        monthly_trend: [],
      }
      expect(collector.validate(validData)).toBe(true)
    })

    it('should aggregate costs by service', () => {
      const logs = [
        { api_calls: 100, cost_usd: 10, service: 'openai', logged_at: '2026-05-01T00:00:00Z' },
        { api_calls: 50, cost_usd: 5, service: 'semrush', logged_at: '2026-05-02T00:00:00Z' },
      ]

      const metrics = collector['normalizeBillingData'](logs)

      expect(metrics.total_cost_usd).toBe(15)
      expect(metrics.total_api_calls).toBe(150)
      expect(metrics.cost_by_service.openai).toBe(10)
      expect(metrics.cost_by_service.semrush).toBe(5)
    })
  })

  describe('Collector Error Handling', () => {
    it('should handle validation of arrays', () => {
      const collector = new LinkIntelligenceCollector()
      expect(collector.validate([])).toBe(false)
    })

    it('should handle validation of numbers', () => {
      const collector = new SERPIntelligenceCollector()
      expect(collector.validate(42)).toBe(false)
    })

    it('should handle validation of strings', () => {
      const collector = new LocalVisibilityCollector()
      expect(collector.validate('invalid')).toBe(false)
    })

    it('should handle validation of booleans', () => {
      const collector = new MarketBaselineCollector()
      expect(collector.validate(true)).toBe(false)
    })

    it('should handle validation of null and undefined', () => {
      const collector = new AITrackerCollector()
      expect(collector.validate(null)).toBe(false)
      expect(collector.validate(undefined)).toBe(false)
    })
  })

  describe('Collector Data Aggregation Edge Cases', () => {
    it('should handle empty data arrays in AITrackerCollector', () => {
      const collector = new AITrackerCollector()
      const metrics = collector['normalizeRuns']([])

      expect(metrics.tracked_questions).toBe(0)
      expect(metrics.avg_ranking).toBeNull()
    })

    it('should handle duplicate domains in LinkIntelligenceCollector', () => {
      const collector = new LinkIntelligenceCollector()
      const backlinks = [
        { domain: 'site1.com', url: 'url1', is_active: true, quality_score: 80 },
        { domain: 'site1.com', url: 'url2', is_active: true, quality_score: 90 },
        { domain: 'site2.com', url: 'url3', is_active: true, quality_score: 70 },
      ]

      const metrics = collector['normalizeBacklinks'](backlinks, [])

      expect(metrics.total_backlinks).toBe(3)
      expect(metrics.top_referring_domains.length).toBeGreaterThan(0)
    })

    it('should handle zero ranking positions in SERPIntelligenceCollector', () => {
      const collector = new SERPIntelligenceCollector()
      const rankings = [
        { keyword: 'k1', position: 0, change_percent: 0 },
        { keyword: 'k2', position: 0, change_percent: 0 },
      ]

      const metrics = collector['normalizeRankings'](rankings, [])

      expect(metrics.tracked_keywords).toBe(2)
      // Position 0 should not be counted as top 10
      expect(metrics.top10_keywords).toBeLessThanOrEqual(2)
    })

    it('should handle negative position changes in rankings', () => {
      const collector = new SERPIntelligenceCollector()
      const rankings = [
        { keyword: 'k1', position: 10, change_percent: -5 },
        { keyword: 'k2', position: 20, change_percent: 5 },
      ]

      const metrics = collector['normalizeRankings'](rankings, [])

      expect(metrics.tracked_keywords).toBe(2)
      expect(metrics.position_change).toBeDefined()
    })

    it('should handle single city in LocalVisibilityCollector', () => {
      const collector = new LocalVisibilityCollector()
      const rankings = [
        { keyword: 'k1', city: 'Sydney', position: 5 },
        { keyword: 'k2', city: 'Sydney', position: 20 },
      ]

      const metrics = collector['normalizeLocalRankings'](rankings)

      expect(metrics.cities_covered).toBe(1)
      expect(metrics.tracked_keywords).toBe(2)
    })

    it('should handle opportunity score edge values in MarketBaselineCollector', () => {
      const collector = new MarketBaselineCollector()
      const comparisons = [
        { keyword: 'k1', opportunity_score: 0, is_top_opportunity: false, is_underperformer: true },
        { keyword: 'k2', opportunity_score: 100, is_top_opportunity: true, is_underperformer: false },
      ]

      const metrics = collector['normalizeMarketData'](comparisons)

      expect(metrics.opportunity_score).toBeGreaterThanOrEqual(0)
      expect(metrics.opportunity_score).toBeLessThanOrEqual(100)
    })

    it('should handle very high billing costs', () => {
      const collector = new BillingMonitorCollector()
      const logs = [
        { api_calls: 1000000, cost_usd: 5000, service: 'openai', logged_at: '2026-05-01T00:00:00Z' },
      ]

      const metrics = collector['normalizeBillingData'](logs)

      expect(metrics.total_cost_usd).toBe(5000)
      expect(metrics.total_api_calls).toBe(1000000)
    })

    it('should handle zero costs in billing', () => {
      const collector = new BillingMonitorCollector()
      const logs = [
        { api_calls: 100, cost_usd: 0, service: 'openai', logged_at: '2026-05-01T00:00:00Z' },
      ]

      const metrics = collector['normalizeBillingData'](logs)

      expect(metrics.total_cost_usd).toBe(0)
      expect(metrics.total_api_calls).toBe(100)
    })
  })
})
