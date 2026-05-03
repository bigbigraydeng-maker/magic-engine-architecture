import { DataSourceCollectorBase } from '../collector-base'
import { LocalVisibilityMetrics } from '@/types/monthly-report'

export class LocalVisibilityCollector extends DataSourceCollectorBase {
  name = 'Local Visibility'
  datasource_type = 'local'

  /**
   * Collect local SERP ranking metrics for a client in a given month
   */
  async collect(clientId: string, month: string): Promise<LocalVisibilityMetrics | null> {
    const [year, monthNum] = month.split('-')
    const monthStart = new Date(parseInt(year), parseInt(monthNum) - 1, 1)
    const monthEnd = new Date(parseInt(year), parseInt(monthNum), 0)

    const { data: rankings, error } = await this.supabase
      .from('local_serp_rankings')
      .select('id, keyword, city, position, detected_at')
      .eq('client_id', clientId)
      .gte('detected_at', monthStart.toISOString())
      .lte('detected_at', monthEnd.toISOString())
      .order('detected_at', { ascending: false })

    if (error) {
      throw new Error(`Failed to fetch local SERP rankings: ${error.message}`)
    }

    if (!rankings || rankings.length === 0) {
      return null
    }

    const metrics = this.normalizeLocalRankings(rankings)
    return metrics
  }

  /**
   * Normalize raw local SERP data into LocalVisibilityMetrics
   */
  private normalizeLocalRankings(rankings: any[]): LocalVisibilityMetrics {
    // Deduplicate by keyword (latest ranking per keyword)
    const latestByKeyword = new Map<string, any>()
    rankings.forEach((r) => {
      if (!latestByKeyword.has(r.keyword)) {
        latestByKeyword.set(r.keyword, r)
      }
    })

    const uniqueRankings = Array.from(latestByKeyword.values())

    // Calculate metrics
    const avgPosition =
      uniqueRankings.length > 0
        ? uniqueRankings.reduce((sum, r) => sum + (r.position || 100), 0) / uniqueRankings.length
        : null

    // Count top 10
    const top10Count = uniqueRankings.filter((r) => r.position <= 10).length

    // Get unique cities
    const cities = new Set(rankings.map((r) => r.city))
    const citiesList = Array.from(cities)

    // Calculate per-city metrics
    const cityMetrics = citiesList.map((city) => {
      const cityRankings = uniqueRankings.filter((r) => r.city === city)
      const cityAvgPos =
        cityRankings.length > 0
          ? cityRankings.reduce((sum, r) => sum + (r.position || 100), 0) / cityRankings.length
          : 100

      const cityTop10 = cityRankings.filter((r) => r.position <= 10).length

      return {
        city,
        avg_position: parseFloat(cityAvgPos.toFixed(2)),
        top10_count: cityTop10,
      }
    })

    return {
      avg_position: avgPosition,
      tracked_keywords: uniqueRankings.length,
      top10_keywords: top10Count,
      cities_covered: citiesList.length,
      top_cities: cityMetrics.slice(0, 10),
    }
  }

  /**
   * Validate local visibility data
   */
  validate(data: LocalVisibilityMetrics): boolean {
    if (!data) return false
    if (typeof data !== 'object') return false
    if (typeof data.tracked_keywords !== 'number') return false
    return true
  }

  /**
   * Normalize raw data to LocalVisibilityMetrics
   */
  async normalize(data: any): Promise<LocalVisibilityMetrics> {
    if (Array.isArray(data)) {
      return this.normalizeLocalRankings(data)
    }
    return data as LocalVisibilityMetrics
  }

  /**
   * Execute full collection pipeline
   */
  async execute(clientId: string, month: string): Promise<void> {
    const data = await this.collect(clientId, month)
    if (!data) {
      console.log(`No local visibility data for client ${clientId} in month ${month}`)
      return
    }

    if (!this.validate(data)) {
      throw new Error('Invalid local visibility data')
    }

    const normalized = await this.normalize(data)

    const reportId = await this.updateReport(clientId, month, {
      local_avg_position: normalized.avg_position,
      local_tracked_keywords: normalized.tracked_keywords,
      local_top10_keywords: normalized.top10_keywords,
      local_cities_covered: normalized.cities_covered,
    })

    await this.storeSection(reportId, normalized)
  }
}
