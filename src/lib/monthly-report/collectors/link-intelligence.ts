import { DataSourceCollectorBase } from '../collector-base'
import { LinkIntelligenceMetrics } from '@/types/monthly-report'

export class LinkIntelligenceCollector extends DataSourceCollectorBase {
  name = 'Link Intelligence'
  datasource_type = 'link_intel'

  /**
   * Collect backlink metrics for a client in a given month
   */
  async collect(clientId: string, month: string): Promise<LinkIntelligenceMetrics | null> {
    const [year, monthNum] = month.split('-')
    const monthStart = new Date(parseInt(year), parseInt(monthNum) - 1, 1)
    const monthEnd = new Date(parseInt(year), parseInt(monthNum), 0)

    // Get current month backlinks
    const { data: currentMonth, error: currentError } = await this.supabase
      .from('datasource_backlinks')
      .select('id, domain, url, is_active, quality_score, detected_at')
      .eq('client_id', clientId)
      .gte('detected_at', monthStart.toISOString())
      .lte('detected_at', monthEnd.toISOString())

    if (currentError) {
      throw new Error(`Failed to fetch backlinks: ${currentError.message}`)
    }

    // Get previous month for comparison
    const prevMonthStart = new Date(parseInt(year), parseInt(monthNum) - 2, 1)
    const prevMonthEnd = new Date(parseInt(year), parseInt(monthNum) - 1, 0)

    const { data: previousMonth, error: prevError } = await this.supabase
      .from('datasource_backlinks')
      .select('id, domain, url')
      .eq('client_id', clientId)
      .gte('detected_at', prevMonthStart.toISOString())
      .lte('detected_at', prevMonthEnd.toISOString())

    if (prevError) {
      throw new Error(`Failed to fetch previous month backlinks: ${prevError.message}`)
    }

    const metrics = this.normalizeBacklinks(currentMonth || [], previousMonth || [])
    return metrics
  }

  /**
   * Normalize raw backlink data into LinkIntelligenceMetrics
   */
  private normalizeBacklinks(currentMonth: any[], previousMonth: any[]): LinkIntelligenceMetrics {
    const currentSet = new Set(currentMonth.map((b) => `${b.domain}|${b.url}`))
    const previousSet = new Set(previousMonth.map((b) => `${b.domain}|${b.url}`))

    // Calculate new and lost backlinks
    const newBacklinks = [...currentSet].filter((b) => !previousSet.has(b)).length
    const lostBacklinks = [...previousSet].filter((b) => !currentSet.has(b)).length

    // Calculate quality score (average quality_score of active backlinks)
    const activeBacklinks = currentMonth.filter((b) => b.is_active)
    const qualityScores = activeBacklinks
      .map((b) => b.quality_score)
      .filter((q) => q !== null && q !== undefined)
    const avgQualityScore =
      qualityScores.length > 0 ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length : null

    // Get top referring domains
    const domainCounts = new Map<string, number>()
    currentMonth.forEach((b) => {
      domainCounts.set(b.domain, (domainCounts.get(b.domain) || 0) + 1)
    })

    const topDomains = Array.from(domainCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([domain]) => domain)

    // Calculate backlink velocity (new links per day, assuming 30 days in a month)
    const velocity = newBacklinks / 30

    return {
      total_backlinks: currentMonth.length,
      new_backlinks_this_month: newBacklinks,
      lost_backlinks_this_month: lostBacklinks,
      quality_score: avgQualityScore,
      top_referring_domains: topDomains,
      backlink_velocity: velocity,
    }
  }

  /**
   * Validate link intelligence data
   */
  validate(data: LinkIntelligenceMetrics): boolean {
    if (!data) return false
    if (typeof data !== 'object') return false
    if (typeof data.total_backlinks !== 'number') return false
    return true
  }

  /**
   * Normalize raw data to LinkIntelligenceMetrics
   */
  async normalize(data: any): Promise<LinkIntelligenceMetrics> {
    if (Array.isArray(data)) {
      return this.normalizeBacklinks(data, [])
    }
    return data as LinkIntelligenceMetrics
  }

  /**
   * Execute full collection pipeline
   */
  async execute(clientId: string, month: string): Promise<void> {
    const data = await this.collect(clientId, month)
    if (!data) {
      console.log(`No link intelligence data for client ${clientId} in month ${month}`)
      return
    }

    if (!this.validate(data)) {
      throw new Error('Invalid link intelligence data')
    }

    const normalized = await this.normalize(data)

    const reportId = await this.updateReport(clientId, month, {
      backlinks_total: normalized.total_backlinks,
      backlinks_new_this_month: normalized.new_backlinks_this_month,
      backlinks_lost_this_month: normalized.lost_backlinks_this_month,
      backlinks_quality_score: normalized.quality_score,
    })

    await this.storeSection(reportId, normalized)
  }
}
