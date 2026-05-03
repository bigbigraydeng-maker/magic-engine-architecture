/**
 * Monthly Report Aggregation Types (P8.C.1)
 * Consolidated view across 6 datasources
 */

// ============================================================================
// Individual Datasource Metrics
// ============================================================================

export interface AITrackerMetrics {
  avg_ranking: number | null
  ranking_change: number | null
  tracked_questions: number
  top_questions: string[]
  lowest_ranking_questions: string[]
}

export interface LinkIntelligenceMetrics {
  total_backlinks: number
  new_backlinks_this_month: number
  lost_backlinks_this_month: number
  quality_score: number | null
  top_referring_domains: string[]
  backlink_velocity: number // new links per day
}

export interface SERPIntelligenceMetrics {
  avg_position: number | null
  position_change: number | null
  tracked_keywords: number
  top10_keywords: number
  top50_keywords: number
  new_rankings: number
  lost_rankings: number
  top_keywords: Array<{
    keyword: string
    position: number
    change: number
  }>
}

export interface LocalVisibilityMetrics {
  avg_position: number | null
  tracked_keywords: number
  top10_keywords: number
  cities_covered: number
  top_cities: Array<{
    city: string
    avg_position: number
    top10_count: number
  }>
}

export interface MarketBaselineMetrics {
  opportunity_score: number | null
  top_opportunities: number
  underperformers: number
  market_strength: 'ahead' | 'aligned' | 'behind'
  top_opportunity_keywords: string[]
}

export interface BillingMetrics {
  total_cost_usd: number
  total_api_calls: number
  cost_by_service: Record<string, number>
  monthly_trend: Array<{
    service: string
    calls: number
    cost: number
  }>
}

// ============================================================================
// Aggregated Report
// ============================================================================

export interface DataSourceMonthlyReport {
  id?: number
  client_id: string
  month: string // YYYY-MM

  ai_tracker: AITrackerMetrics
  link_intelligence: LinkIntelligenceMetrics
  serp_intelligence: SERPIntelligenceMetrics
  local_visibility: LocalVisibilityMetrics
  market_baseline: MarketBaselineMetrics
  billing: BillingMetrics

  // Overall health indicator
  overall_health_score: number // 0-100
  health_trend: 'improving' | 'stable' | 'declining'

  // Timestamps
  last_synced_at?: Date
  created_at?: Date
  updated_at?: Date
}

// ============================================================================
// Report Sections (for UI rendering)
// ============================================================================

export interface ReportSection {
  id?: number
  report_id?: number
  section_type: 'ai_tracker' | 'link_intel' | 'serp' | 'local' | 'market' | 'billing'
  title: string
  subtitle?: string
  metrics: Record<string, any>
  key_insights: string[]
  recommendations: string[]
  trend_indicator?: 'up' | 'down' | 'neutral'
  last_updated?: Date
}

// ============================================================================
// Collector Interface (Base for all collectors)
// ============================================================================

export interface IDataSourceCollector {
  name: string
  datasource_type: string

  /**
   * Collect data for a given client and month
   */
  collect(clientId: string, month: string): Promise<any>

  /**
   * Validate collected data before storage
   */
  validate(data: any): boolean

  /**
   * Transform raw data to normalized metrics
   */
  normalize(data: any): any
}

// ============================================================================
// Report Generation Request/Response
// ============================================================================

export interface GenerateReportRequest {
  client_id: string
  month: string // YYYY-MM
  include_trends?: boolean
  include_recommendations?: boolean
}

export interface GenerateReportResponse {
  success: boolean
  report?: DataSourceMonthlyReport
  sections?: ReportSection[]
  errors?: {
    datasource: string
    error: string
  }[]
  warnings?: string[]
}

// ============================================================================
// Report Summary (for dashboard/overview)
// ============================================================================

export interface ReportSummary {
  client_id: string
  month: string
  health_score: number
  key_metrics: {
    label: string
    value: string | number
    change?: number
    status: 'up' | 'down' | 'neutral'
  }[]
  highlights: string[]
  concerns: string[]
}
