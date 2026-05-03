import { DataSourceCollectorBase } from '../collector-base'
import { SERPIntelligenceMetrics } from '@/types/monthly-report'

export class SERPIntelligenceCollector extends DataSourceCollectorBase {
  name = 'SERP Intelligence'
  datasource_type = 'serp'

  /**
   * Collect SERP ranking metrics for a client in a given month
   */
  async collect(clientId: string, month: string): Promise<SERPIntelligenceMetrics | null> {
    const [year, monthNum] = month.split('-')
    const monthStart = new Date(parseInt(year), parseInt(monthNum) - 1, 1)
    const monthEnd = new Date(parseInt(year), parseInt(monthNum), 0)

    // Get current month rankings
    const { data: currentMonth, error: currentError } = await this.supabase
      .from('serp_rankings')
      .select('id, keyword, position, change_percent, detected_at')
      .eq('client_id', clientId)
      .gte('detected_at', monthStart.toISOString())
      .lte('detected_at', monthEnd.toISOString())
      .order('detected_at', { ascending: false })

    if (currentError) {
      throw new Error(`Failed to fetch SERP rankings: ${currentError.message}`)
    }

    // Get previous month for comparison
    const prevMonthStart = new Date(parseInt(year), parseInt(monthNum) - 2, 1)
    const prevMonthEnd = new Date(parseInt(year), parseInt(monthNum) - 1, 0)

    const { data: previousMonth, error: prevError } = await this.supabase
      .from('serp_rankings')
      .select('keyword, position')
      .eq('client_id', clientId)
      .gte('detected_at', prevMonthStart.toISOString())
      .lte('detected_at', prevMonthEnd.toISOString())

    if (prevError) {
      throw new Error(`Failed to fetch previous month SERP: ${prevError.message}`)
    }

    const metrics = this.normalizeRankings(currentMonth || [], previousMonth || [])
    return metrics
  }

  /**
   * Normalize raw SERP rankings into SERPIntelligenceMetrics
   */
  private normalizeRankings(currentMonth: any[], previousMonth: any[]): SERPIntelligenceMetrics {
    // Build keyword position maps
    const currentMap = new Map<string, number>()
    currentMonth.forEach((r) => {
      if (!currentMap.has(r.keyword)) {
        currentMap.set(r.keyword, r.position)
      }
    })

    const previousMap = new Map<string, number>()
    previousMonth.forEach((r) => {
      if (!previousMap.has(r.keyword)) {
        previousMap.set(r.keyword, r.position)
      }
    })

    // Calculate metrics
    const avgPosition =
      currentMonth.length > 0
        ? currentMonth.reduce((sum, r) => sum + (r.position || 100), 0) / currentMonth.length
        : null

    // Find new and lost rankings
    const newRankings = Array.from(currentMap.keys()).filter((k) => !previousMap.has(k)).length
    const lostRankings = Array.from(previousMap.keys()).filter((k) => !currentMap.has(k)).length

    // Calculate position change (average movement)
    let positionChange = null
    if (previousMonth.length > 0) {
      let totalChange = 0
      let countComparable = 0
      currentMap.forEach((currentPos, keyword) => {
        const previousPos = previousMap.get(keyword)
        if (previousPos !== undefined) {
          totalChange += currentPos - previousPos
          countComparable++
        }
      })
      if (countComparable > 0) {
        positionChange = totalChange / countComparable
      }
    }

    // Count keywords in top 10 and top 50
    const top10 = currentMonth.filter((r) => r.position <= 10).length
    const top50 = currentMonth.filter((r) => r.position <= 50).length

    // Get top keywords by position
    const topKeywords = currentMonth
      .sort((a, b) => (a.position || 100) - (b.position || 100))
      .slice(0, 10)
      .map((r) => ({
        keyword: r.keyword,
        position: r.position,
        change: r.change_percent || 0,
      }))

    return {
      avg_position: avgPosition,
      position_change: positionChange,
      tracked_keywords: currentMap.size,
      top10_keywords: top10,
      top50_keywords: top50,
      new_rankings: newRankings,
      lost_rankings: lostRankings,
      top_keywords: topKeywords,
    }
  }

  /**
   * Validate SERP data
   */
  validate(data: SERPIntelligenceMetrics): boolean {
    if (!data) return false
    if (typeof data !== 'object') return false
    if (typeof data.tracked_keywords !== 'number') return false
    return true
  }

  /**
   * Normalize raw data to SERPIntelligenceMetrics
   */
  async normalize(data: any): Promise<SERPIntelligenceMetrics> {
    if (Array.isArray(data)) {
      return this.normalizeRankings(data, [])
    }
    return data as SERPIntelligenceMetrics
  }

  /**
   * Execute full collection pipeline
   */
  async execute(clientId: string, month: string): Promise<void> {
    const data = await this.collect(clientId, month)
    if (!data) {
      console.log(`No SERP data for client ${clientId} in month ${month}`)
      return
    }

    if (!this.validate(data)) {
      throw new Error('Invalid SERP data')
    }

    const normalized = await this.normalize(data)

    const reportId = await this.updateReport(clientId, month, {
      serp_avg_position: normalized.avg_position,
      serp_position_change: normalized.position_change,
      serp_tracked_keywords: normalized.tracked_keywords,
      serp_top10_keywords: normalized.top10_keywords,
      serp_top50_keywords: normalized.top50_keywords,
      serp_new_rankings: normalized.new_rankings,
      serp_lost_rankings: normalized.lost_rankings,
    })

    await this.storeSection(reportId, normalized)
  }
}
