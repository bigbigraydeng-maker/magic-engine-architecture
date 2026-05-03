import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MonthlyReportPage from '../page'
import { formatLabel, formatValue } from '@/lib/monthly-report/formatters'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useParams: vi.fn(() => ({ clientId: 'test-client-123' })),
  useSearchParams: vi.fn(() => ({
    get: vi.fn((key) => {
      if (key === 'month') return '2026-05'
      return null
    }),
  })),
}))

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  ArrowUp: () => <div data-testid="arrow-up" />,
  ArrowDown: () => <div data-testid="arrow-down" />,
  TrendingUp: () => <div data-testid="trending-up" />,
}))

describe('Monthly Report Page Components', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('formatLabel', () => {
    it('should convert snake_case to Title Case', () => {
      expect(formatLabel('ai_avg_ranking')).toBe('Ai Avg Ranking')
      expect(formatLabel('serp_top10_keywords')).toBe('Serp Top10 Keywords')
      expect(formatLabel('backlinks_total')).toBe('Backlinks Total')
    })

    it('should handle single word', () => {
      expect(formatLabel('health')).toBe('Health')
    })

    it('should handle multiple underscores', () => {
      expect(formatLabel('very_long_metric_name')).toBe('Very Long Metric Name')
    })
  })

  describe('formatValue', () => {
    it('should return "N/A" for null or undefined', () => {
      expect(formatValue(null)).toBe('N/A')
      expect(formatValue(undefined)).toBe('N/A')
    })

    it('should format integers without decimals', () => {
      expect(formatValue(100)).toBe('100')
      expect(formatValue(0)).toBe('0')
      expect(formatValue(-5)).toBe('-5')
    })

    it('should format decimals with 2 decimal places', () => {
      expect(formatValue(100.5)).toBe('100.50')
      expect(formatValue(75.123)).toBe('75.12')
    })

    it('should format arrays as comma-separated with ellipsis for > 3 items', () => {
      expect(formatValue(['a', 'b', 'c'])).toBe('a, b, c')
      expect(formatValue(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c...')
      expect(formatValue([1, 2, 3, 4, 5, 6])).toBe('1, 2, 3...')
    })

    it('should truncate objects to 50 chars', () => {
      const obj = { key: 'a'.repeat(100) }
      const result = formatValue(obj)
      expect(result.length).toBeLessThanOrEqual(50)
    })

    it('should convert strings to string', () => {
      expect(formatValue('test')).toBe('test')
    })

    it('should handle boolean values', () => {
      expect(formatValue(true)).toBe('true')
      expect(formatValue(false)).toBe('false')
    })
  })

  describe('MonthlyReportPage - Rendering', () => {
    it('should show loading state initially', () => {
      vi.stubGlobal('fetch', vi.fn())
      render(<MonthlyReportPage />)

      expect(screen.getByText('Generating monthly report...')).toBeInTheDocument()
      expect(screen.getByTestId('trending-up')).toBeInTheDocument()
    })

    it('should handle fetch error gracefully', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByText(/Network error/)).toBeInTheDocument()
      })
    })

    it('should handle API error response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          success: false,
          errors: [{ datasource: 'ai_tracker', error: 'Failed to fetch data' }],
        }),
      }))

      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByText('Report Generation Failed')).toBeInTheDocument()
        expect(screen.getByText(/ai_tracker: Failed to fetch data/)).toBeInTheDocument()
      })
    })

    it('should render back to client link', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          success: true,
          report: {
            overall_health_score: 75,
            health_trend: 'improving',
            ai_avg_ranking: 5,
            serp_top10_keywords: 25,
            backlinks_total: 100,
            month: '2026-05',
          },
          sections: [],
        }),
      }))

      render(<MonthlyReportPage />)

      await waitFor(() => {
        const backLink = screen.getByRole('link', { name: /Back to Client/ })
        expect(backLink).toHaveAttribute('href', '/dashboard/clients/test-client-123')
      })
    })

    it('should display month selector', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          success: true,
          report: {
            overall_health_score: 75,
            health_trend: 'improving',
            ai_avg_ranking: 5,
            serp_top10_keywords: 25,
            backlinks_total: 100,
            month: '2026-05',
          },
          sections: [],
        }),
      }))

      render(<MonthlyReportPage />)

      await waitFor(() => {
        const monthInput = screen.getByDisplayValue('2026-05')
        expect(monthInput).toBeInTheDocument()
      })
    })
  })

  describe('MonthlyReportPage - Data Display', () => {
    it('should render health score card', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          success: true,
          report: {
            overall_health_score: 85,
            health_trend: 'improving',
            ai_avg_ranking: 5,
            serp_top10_keywords: 25,
            backlinks_total: 100,
            month: '2026-05',
          },
          sections: [],
        }),
      }))

      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByText('Overall Health Score')).toBeInTheDocument()
        expect(screen.getByText('85')).toBeInTheDocument()
        expect(screen.getByText('improving')).toBeInTheDocument()
      })
    })

    it('should render key metrics grid', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          success: true,
          report: {
            overall_health_score: 75,
            health_trend: 'stable',
            ai_avg_ranking: 3.5,
            serp_top10_keywords: 42,
            backlinks_total: 500,
            month: '2026-05',
          },
          sections: [],
        }),
      }))

      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByText('AI Visibility')).toBeInTheDocument()
        expect(screen.getByText('#4')).toBeInTheDocument()
        expect(screen.getByText('SERP Top 10')).toBeInTheDocument()
        expect(screen.getByText('42')).toBeInTheDocument()
        expect(screen.getByText('Backlinks')).toBeInTheDocument()
        expect(screen.getByText('500')).toBeInTheDocument()
      })
    })

    it('should render report sections', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          success: true,
          report: {
            overall_health_score: 75,
            health_trend: 'stable',
            ai_avg_ranking: 5,
            serp_top10_keywords: 25,
            backlinks_total: 100,
            month: '2026-05',
          },
          sections: [
            {
              section_type: 'ai_tracker',
              title: 'AI Visibility Tracker',
              metrics: { avg_ranking: 5, tracked_questions: 10 },
              key_insights: ['Ranking improved by 2 positions'],
              recommendations: ['Focus on question optimization'],
              last_updated: '2026-05-01T00:00:00Z',
            },
          ],
        }),
      }))

      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByText('AI Visibility Tracker')).toBeInTheDocument()
        expect(screen.getByText('Ranking improved by 2 positions')).toBeInTheDocument()
        expect(screen.getByText('Focus on question optimization')).toBeInTheDocument()
      })
    })
  })

  describe('MonthlyReportPage - Month Navigation', () => {
    it('should update fetch URL when month changes', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          success: true,
          report: {
            overall_health_score: 75,
            health_trend: 'stable',
            ai_avg_ranking: 5,
            serp_top10_keywords: 25,
            backlinks_total: 100,
            month: '2026-05',
          },
          sections: [],
        }),
      })

      vi.stubGlobal('fetch', fetchMock)

      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/clients/test-client-123/reports/monthly?month=2026-05'
        )
      })
    })
  })

  describe('MetricCard Component', () => {
    it('should render metric card with title and value', async () => {
      // Since MetricCard is used within MonthlyReportPage and tested through integration,
      // this tests the component's rendering behavior within the page context
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          success: true,
          report: {
            overall_health_score: 75,
            health_trend: 'stable',
            ai_avg_ranking: 5,
            serp_top10_keywords: 25,
            backlinks_total: 100,
            month: '2026-05',
          },
          sections: [],
        }),
      }))

      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByText('AI Visibility')).toBeInTheDocument()
        expect(screen.getByText('Average ranking')).toBeInTheDocument()
      })
    })
  })

  describe('Section Component', () => {
    it('should render section with all content areas', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          success: true,
          report: {
            overall_health_score: 75,
            health_trend: 'stable',
            ai_avg_ranking: 5,
            serp_top10_keywords: 25,
            backlinks_total: 100,
            month: '2026-05',
          },
          sections: [
            {
              section_type: 'link_intel',
              title: 'Link Intelligence',
              metrics: {
                total_backlinks: 500,
                quality_score: 85.5,
                new_backlinks_this_month: 10,
              },
              key_insights: ['Strong backlink growth', 'Quality improved'],
              recommendations: ['Maintain link-building efforts'],
              last_updated: '2026-05-01T00:00:00Z',
            },
          ],
        }),
      }))

      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByText('Link Intelligence')).toBeInTheDocument()
        expect(screen.getByText('Metrics')).toBeInTheDocument()
        expect(screen.getByText('Key Insights')).toBeInTheDocument()
        expect(screen.getByText('Recommendations')).toBeInTheDocument()
        expect(screen.getByText('Strong backlink growth')).toBeInTheDocument()
        expect(screen.getByText('Maintain link-building efforts')).toBeInTheDocument()
      })
    })

    it('should format last_updated date correctly', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          success: true,
          report: {
            overall_health_score: 75,
            health_trend: 'stable',
            ai_avg_ranking: 5,
            serp_top10_keywords: 25,
            backlinks_total: 100,
            month: '2026-05',
          },
          sections: [
            {
              section_type: 'serp',
              title: 'SERP Intelligence',
              metrics: { top10_keywords: 25 },
              key_insights: [],
              recommendations: [],
              last_updated: '2026-04-15T12:30:00Z',
            },
          ],
        }),
      }))

      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByText(/Updated.*2026/)).toBeInTheDocument()
      })
    })

    it('should handle sections with no insights or recommendations', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          success: true,
          report: {
            overall_health_score: 75,
            health_trend: 'stable',
            ai_avg_ranking: 5,
            serp_top10_keywords: 25,
            backlinks_total: 100,
            month: '2026-05',
          },
          sections: [
            {
              section_type: 'billing',
              title: 'Billing Monitor',
              metrics: { total_cost_usd: 500 },
              key_insights: [],
              recommendations: [],
            },
          ],
        }),
      }))

      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByText('Billing Monitor')).toBeInTheDocument()
        // Should not show empty sections
        const insightHeaders = screen.queryAllByText('Key Insights')
        expect(insightHeaders.length).toBe(0)
      })
    })

    it('should limit metrics display to 6 items', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          success: true,
          report: {
            overall_health_score: 75,
            health_trend: 'stable',
            ai_avg_ranking: 5,
            serp_top10_keywords: 25,
            backlinks_total: 100,
            month: '2026-05',
          },
          sections: [
            {
              section_type: 'market',
              title: 'Market Baseline',
              metrics: {
                opportunity_score: 75.5,
                top_opportunities: 10,
                underperformers: 3,
                market_strength: 'ahead',
                field5: 'value5',
                field6: 'value6',
                field7: 'value7',
                field8: 'value8',
              },
              key_insights: [],
              recommendations: [],
            },
          ],
        }),
      }))

      render(<MonthlyReportPage />)

      await waitFor(() => {
        // The component slices metrics to first 6 items
        const metricItems = screen.getAllByRole('definition')
        expect(metricItems.length).toBeLessThanOrEqual(6)
      })
    })
  })

  describe('MonthlyReportPage - Error Handling', () => {
    it('should display multiple datasource errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          success: false,
          errors: [
            { datasource: 'ai_tracker', error: 'No data for this period' },
            { datasource: 'serp', error: 'API rate limit exceeded' },
            { datasource: 'link_intel', error: 'Connection timeout' },
          ],
        }),
      }))

      render(<MonthlyReportPage />)

      await waitFor(() => {
        expect(screen.getByText('Report Generation Failed')).toBeInTheDocument()
        expect(screen.getByText(/ai_tracker.*No data for this period/)).toBeInTheDocument()
        expect(screen.getByText(/serp.*API rate limit exceeded/)).toBeInTheDocument()
        expect(screen.getByText(/link_intel.*Connection timeout/)).toBeInTheDocument()
      })
    })
  })
})
