import { DataSourceCollectorBase } from '../collector-base'
import { MarketBaselineMetrics } from '@/types/monthly-report'

export class MarketBaselineCollector extends DataSourceCollectorBase {
  name = 'Market Baseline'
  datasource_type = 'market'

  /**
   * Collect market baseline metrics for a client in a given month
   */
  async collect(clientId: string, month: string): Promise<MarketBaselineMetrics | null> {
    const [year, monthNum] = month.split('-')
    const monthStart = new Date(parseInt(year), parseInt(monthNum) - 1, 1)
    const monthEnd = new Date(parseInt(year), parseInt(monthNum), 0)

    const { data: comparisons, error } = await this.supabase
      .from('market_baseline')
      .select('id, opportunity_score, is_top_opportunity, is_underperformer, keyword, detected_at')
      .eq('client_id', clientId)
      .gte('detected_at', monthStart.toISOString())
      .lte('detected_at', monthEnd.toISOString())
      .order('detected_at', { ascending: false })

    if (error) {
      throw new Error(`Failed to fetch market baseline: ${error.message}`)
    }

    if (!comparisons || comparisons.length === 0) {
      return null
    }

    const metrics = this.normalizeMarketData(comparisons)
    return metrics
  }

  /**
   * Normalize raw market baseline data into MarketBaselineMetrics
   */
  private normalizeMarketData(comparisons: any[]): MarketBaselineMetrics {
    // Deduplicate by keyword (latest comparison per keyword)
    const latestByKeyword = new Map<string, any>()
    comparisons.forEach((c) => {
      if (!latestByKeyword.has(c.keyword)) {
        latestByKeyword.set(c.keyword, c)
      }
    })

    const uniqueComparisons = Array.from(latestByKeyword.values())

    // Calculate metrics
    const opportunityScores = uniqueComparisons
      .map((c) => c.opportunity_score)
      .filter((s) => s !== null && s !== undefined)

    const avgOpportunityScore =
      opportunityScores.length > 0
        ? opportunityScores.reduce((a, b) => a + b, 0) / opportunityScores.length
        : null

    const topOpportunities = uniqueComparisons.filter((c) => c.is_top_opportunity).length
    const underperformers = uniqueComparisons.filter((c) => c.is_underperformer).length

    // Determine market strength based on opportunity distribution
    const marketStrength =
      topOpportunities > underperformers
        ? ('ahead' as const)
        : underperformers > topOpportunities
          ? ('behind' as const)
          : ('aligned' as const)

    // Get top opportunity keywords
    const topOpportunitiesKeywords = uniqueComparisons
      .filter((c) => c.is_top_opportunity)
      .sort((a, b) => (b.opportunity_score || 0) - (a.opportunity_score || 0))
      .slice(0, 10)
      .map((c) => c.keyword)

    return {
      opportunity_score: avgOpportunityScore,
      top_opportunities: topOpportunities,
      underperformers,
      market_strength: marketStrength,
      top_opportunity_keywords: topOpportunitiesKeywords,
    }
  }

  /**
   * Validate market baseline data
   */
  validate(data: MarketBaselineMetrics): boolean {
    if (!data) return false
    if (typeof data !== 'object') return false
    if (typeof data.top_opportunities !== 'number') return false
    if (!['ahead', 'aligned', 'behind'].includes(data.market_strength)) return false
    return true
  }

  /**
   * Normalize raw data to MarketBaselineMetrics
   */
  async normalize(data: any): Promise<MarketBaselineMetrics> {
    if (Array.isArray(data)) {
      return this.normalizeMarketData(data)
    }
    return data as MarketBaselineMetrics
  }

  /**
   * Execute full collection pipeline
   */
  async execute(clientId: string, month: string): Promise<void> {
    const data = await this.collect(clientId, month)
    if (!data) {
      console.log(`No market baseline data for client ${clientId} in month ${month}`)
      return
    }

    if (!this.validate(data)) {
      throw new Error('Invalid market baseline data')
    }

    const normalized = await this.normalize(data)

    const reportId = await this.updateReport(clientId, month, {
      market_opportunity_score: normalized.opportunity_score,
      market_top_opportunities: normalized.top_opportunities,
      market_underperformers: normalized.underperformers,
    })

    await this.storeSection(reportId, normalized)
  }
}
