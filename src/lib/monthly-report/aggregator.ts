import { createClient } from '@supabase/supabase-js'
import { DataSourceMonthlyReport, GenerateReportResponse } from '@/types/monthly-report'
import { AITrackerCollector } from './collectors/ai-tracker'
import { LinkIntelligenceCollector } from './collectors/link-intelligence'
import { SERPIntelligenceCollector } from './collectors/serp-intelligence'
import { LocalVisibilityCollector } from './collectors/local-visibility'
import { MarketBaselineCollector } from './collectors/market-baseline'
import { BillingMonitorCollector } from './collectors/billing-monitor'

export class MonthlyReportAggregator {
  private supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    { auth: { persistSession: false } }
  )

  private collectors = [
    new AITrackerCollector(),
    new LinkIntelligenceCollector(),
    new SERPIntelligenceCollector(),
    new LocalVisibilityCollector(),
    new MarketBaselineCollector(),
    new BillingMonitorCollector(),
  ]

  /**
   * Generate a complete monthly report for a client
   * Orchestrates all 6 datasource collectors and aggregates results
   */
  async generateReport(clientId: string, month: string): Promise<GenerateReportResponse> {
    const errors: Array<{ datasource: string; error: string }> = []
    const warnings: string[] = []

    // Check if report already exists
    let reportId = await this.getExistingReportId(clientId, month)

    // Execute all collectors in parallel
    const results = await Promise.allSettled(
      this.collectors.map((collector) => collector.execute(clientId, month))
    )

    // Track errors
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        errors.push({
          datasource: this.collectors[index].datasource_type,
          error: result.reason?.message || 'Unknown error',
        })
      }
    })

    if (errors.length === this.collectors.length) {
      return {
        success: false,
        errors,
        warnings: ['All datasources failed to collect data'],
      }
    }

    // Fetch the completed report
    const report = await this.fetchReport(clientId, month)

    if (!report) {
      return {
        success: false,
        errors,
        warnings: ['Failed to generate report after collection'],
      }
    }

    // Calculate health score and trend
    const { healthScore, healthTrend } = await this.calculateHealthMetrics(clientId, month)

    // Update report with health metrics
    await this.supabase
      .from('datasource_monthly_reports')
      .update({
        overall_health_score: healthScore,
        health_trend: healthTrend,
        last_synced_at: new Date().toISOString(),
      })
      .eq('id', report.id)

    // Fetch updated report
    const finalReport = await this.fetchReport(clientId, month)

    // Fetch sections for API response
    const { data: sections } = await this.supabase
      .from('datasource_report_sections')
      .select('id, report_id, section_type, section_data, last_updated')
      .eq('report_id', report.id)

    return {
      success: errors.length === 0,
      report: finalReport as DataSourceMonthlyReport,
      sections: (sections || []).map((s) => ({
        id: s.id,
        report_id: s.report_id,
        section_type: s.section_type as
          | 'ai_tracker'
          | 'link_intel'
          | 'serp'
          | 'local'
          | 'market'
          | 'billing',
        title: this.getSectionTitle(s.section_type),
        metrics: s.section_data,
        key_insights: this.generateInsights(s.section_type, s.section_data),
        recommendations: this.generateRecommendations(s.section_type, s.section_data),
        last_updated: s.last_updated,
      })),
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    }
  }

  /**
   * Fetch existing report or return null
   */
  private async getExistingReportId(clientId: string, month: string): Promise<number | null> {
    const { data } = await this.supabase
      .from('datasource_monthly_reports')
      .select('id')
      .eq('client_id', clientId)
      .eq('month', month)
      .single()

    return data?.id || null
  }

  /**
   * Fetch complete report with all metrics
   */
  private async fetchReport(
    clientId: string,
    month: string
  ): Promise<DataSourceMonthlyReport | null> {
    const { data } = await this.supabase
      .from('datasource_monthly_reports')
      .select('*')
      .eq('client_id', clientId)
      .eq('month', month)
      .single()

    return data
  }

  /**
   * Calculate overall health score based on all datasources
   */
  private async calculateHealthMetrics(
    clientId: string,
    month: string
  ): Promise<{ healthScore: number; healthTrend: 'improving' | 'stable' | 'declining' }> {
    const { data: report } = await this.supabase
      .from('datasource_monthly_reports')
      .select('*')
      .eq('client_id', clientId)
      .eq('month', month)
      .single()

    if (!report) {
      return { healthScore: 50, healthTrend: 'stable' }
    }

    // Calculate health score from metrics (0-100)
    const scores = []

    // AI Tracker score: ranking position (lower is better)
    if (report.ai_avg_ranking) {
      const aiScore = Math.max(0, 100 - report.ai_avg_ranking * 5)
      scores.push(aiScore)
    }

    // Link Intelligence score: backlinks and quality
    if (report.backlinks_total > 0) {
      const linkScore = Math.min(100, (report.backlinks_total / 100) * 50)
      scores.push(linkScore)
    }

    // SERP score: keywords in top 10
    if (report.serp_tracked_keywords && report.serp_top10_keywords !== undefined) {
      const serpScore = (report.serp_top10_keywords / Math.max(1, report.serp_tracked_keywords)) * 100
      scores.push(Math.min(100, serpScore))
    }

    // Local Visibility score
    if (report.local_tracked_keywords && report.local_top10_keywords !== undefined) {
      const localScore = (report.local_top10_keywords / Math.max(1, report.local_tracked_keywords)) * 100
      scores.push(Math.min(100, localScore))
    }

    // Market Baseline score
    if (report.market_opportunity_score) {
      const marketScore = Math.min(100, report.market_opportunity_score)
      scores.push(marketScore)
    }

    const healthScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b) / scores.length) : 50

    // Determine trend by comparing with previous month
    const prevMonth = this.getPreviousMonth(report.month)
    const { data: prevReport } = await this.supabase
      .from('datasource_monthly_reports')
      .select('overall_health_score')
      .eq('client_id', clientId)
      .eq('month', prevMonth)
      .single()

    let healthTrend: 'improving' | 'stable' | 'declining' = 'stable'
    if (prevReport && prevReport.overall_health_score) {
      const delta = healthScore - prevReport.overall_health_score
      if (delta > 5) {
        healthTrend = 'improving'
      } else if (delta < -5) {
        healthTrend = 'declining'
      }
    }

    return { healthScore, healthTrend }
  }

  /**
   * Generate insights for a section
   */
  private generateInsights(sectionType: string, data: any): string[] {
    const insights: string[] = []

    switch (sectionType) {
      case 'ai_tracker':
        if (data.avg_ranking) {
          insights.push(`Average AI ranking: #${Math.round(data.avg_ranking)}`)
        }
        if (data.tracked_questions) {
          insights.push(`Tracking ${data.tracked_questions} questions across AI engines`)
        }
        if (data.ranking_change && data.ranking_change > 0) {
          insights.push(`Ranking declined by ${data.ranking_change.toFixed(1)} positions`)
        }
        break

      case 'link_intel':
        if (data.new_backlinks_this_month > 0) {
          insights.push(`Gained ${data.new_backlinks_this_month} new backlinks this month`)
        }
        if (data.quality_score) {
          insights.push(`Average backlink quality score: ${data.quality_score.toFixed(2)}/100`)
        }
        if (data.top_referring_domains?.length > 0) {
          insights.push(`Top referrer: ${data.top_referring_domains[0]}`)
        }
        break

      case 'serp':
        if (data.top10_keywords) {
          insights.push(`${data.top10_keywords} keywords ranking in top 10`)
        }
        if (data.new_rankings > 0) {
          insights.push(`${data.new_rankings} new keyword rankings this month`)
        }
        break

      case 'local':
        if (data.cities_covered) {
          insights.push(`Covering ${data.cities_covered} cities`)
        }
        if (data.avg_position) {
          insights.push(`Average local ranking: #${Math.round(data.avg_position)}`)
        }
        break

      case 'market':
        if (data.market_strength) {
          insights.push(`Market position: ${data.market_strength}`)
        }
        if (data.top_opportunities > 0) {
          insights.push(`${data.top_opportunities} top opportunities identified`)
        }
        break

      case 'billing':
        if (data.total_cost_usd > 0) {
          insights.push(`Total monthly cost: $${data.total_cost_usd.toFixed(2)}`)
        }
        if (data.total_api_calls > 0) {
          insights.push(`${data.total_api_calls.toLocaleString()} API calls used`)
        }
        break
    }

    return insights
  }

  /**
   * Generate recommendations for a section
   */
  private generateRecommendations(sectionType: string, data: any): string[] {
    const recommendations: string[] = []

    switch (sectionType) {
      case 'ai_tracker':
        if (data.ranking_change && data.ranking_change > 1) {
          recommendations.push('Consider updating content strategy to improve AI visibility')
        }
        if (!data.top_questions || data.top_questions.length === 0) {
          recommendations.push('Generate more industry-specific questions for tracking')
        }
        break

      case 'link_intel':
        if (data.new_backlinks_this_month < 5) {
          recommendations.push('Increase link-building activities to expand backlink profile')
        }
        if (data.quality_score && data.quality_score < 60) {
          recommendations.push('Focus on acquiring high-quality backlinks from authority domains')
        }
        break

      case 'serp':
        if (data.top10_keywords === 0) {
          recommendations.push('Target low-competition keywords to achieve faster rankings')
        }
        if (data.lost_rankings > data.new_rankings) {
          recommendations.push('Review ranking decline - may need content updates')
        }
        break

      case 'local':
        if (data.cities_covered < 5) {
          recommendations.push('Expand local optimization to additional geographic markets')
        }
        break

      case 'market':
        if (data.underperformers > data.top_opportunities) {
          recommendations.push('Reassess market positioning strategy')
        }
        break

      case 'billing':
        if (data.total_cost_usd > 1000) {
          recommendations.push('Review API usage patterns to optimize cost efficiency')
        }
        break
    }

    return recommendations
  }

  /**
   * Get previous month in YYYY-MM format
   */
  private getPreviousMonth(month: string): string {
    const [year, monthNum] = month.split('-')
    const prevMonth = parseInt(monthNum) - 1

    if (prevMonth === 0) {
      return `${parseInt(year) - 1}-12`
    }

    return `${year}-${String(prevMonth).padStart(2, '0')}`
  }

  /**
   * Get section title from section type
   */
  private getSectionTitle(sectionType: string): string {
    const titles: Record<string, string> = {
      ai_tracker: 'AI Visibility Tracker',
      link_intel: 'Link Intelligence',
      serp: 'SERP Intelligence',
      local: 'Local Visibility',
      market: 'Market Baseline',
      billing: 'Billing Monitor',
    }
    return titles[sectionType] || sectionType
  }
}
