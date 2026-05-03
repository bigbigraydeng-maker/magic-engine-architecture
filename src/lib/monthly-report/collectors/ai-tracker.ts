import { DataSourceCollectorBase } from '../collector-base'
import { AITrackerMetrics } from '@/types/monthly-report'

export class AITrackerCollector extends DataSourceCollectorBase {
  name = 'AI Visibility Tracker'
  datasource_type = 'ai_tracker'

  /**
   * Collect AI visibility metrics for a client in a given month
   * Aggregates data from ai_visibility_runs table
   */
  async collect(clientId: string, month: string): Promise<AITrackerMetrics | null> {
    const [year, monthNum] = month.split('-')
    const monthStart = new Date(parseInt(year), parseInt(monthNum) - 1, 1)
    const monthEnd = new Date(parseInt(year), parseInt(monthNum), 0)

    // Fetch all runs for this client in this month
    const { data: runs, error } = await this.supabase
      .from('ai_visibility_runs')
      .select(
        `
        id,
        client_brand_rank,
        ai_engine,
        ran_at,
        query_id,
        ai_visibility_queries(
          question
        )
      `
      )
      .eq('client_id', clientId)
      .gte('ran_at', monthStart.toISOString())
      .lte('ran_at', monthEnd.toISOString())

    if (error) {
      throw new Error(`Failed to fetch AI tracker runs: ${error.message}`)
    }

    if (!runs || runs.length === 0) {
      return null
    }

    // Calculate metrics
    const metrics = this.normalizeRuns(runs)
    return metrics
  }

  /**
   * Normalize raw runs into AITrackerMetrics
   */
  private normalizeRuns(runs: any[]): AITrackerMetrics {
    // Collect all rankings by question
    const rankingsByQuestion: Record<string, number[]> = {}

    runs.forEach((run) => {
      if (run.client_brand_rank && run.ai_visibility_queries) {
        const question = run.ai_visibility_queries.question
        if (!rankingsByQuestion[question]) {
          rankingsByQuestion[question] = []
        }
        rankingsByQuestion[question].push(run.client_brand_rank)
      }
    })

    // Calculate average ranking per question and overall
    const questionMetrics = Object.entries(rankingsByQuestion).map(([question, ranks]) => {
      const avgRank = ranks.reduce((a, b) => a + b, 0) / ranks.length
      return { question, avgRank, count: ranks.length }
    })

    const overallAvgRank =
      questionMetrics.length > 0
        ? questionMetrics.reduce((sum, m) => sum + m.avgRank, 0) / questionMetrics.length
        : null

    // Sort questions by ranking to find top and lowest
    const sortedByRank = [...questionMetrics].sort((a, b) => a.avgRank - b.avgRank)

    // Ranking change: compare first and last run's average positions
    let rankingChange = null
    if (questionMetrics.length > 0) {
      const firstRunAvgRank =
        rankingsByQuestion[sortedByRank[0].question][0] || sortedByRank[0].avgRank
      const lastRunAvgRank =
        rankingsByQuestion[sortedByRank[0].question][
          rankingsByQuestion[sortedByRank[0].question].length - 1
        ] || sortedByRank[0].avgRank
      rankingChange = lastRunAvgRank - firstRunAvgRank
    }

    return {
      avg_ranking: overallAvgRank,
      ranking_change: rankingChange,
      tracked_questions: Object.keys(rankingsByQuestion).length,
      top_questions: sortedByRank.slice(0, 5).map((m) => m.question),
      lowest_ranking_questions: sortedByRank.slice(-5).map((m) => m.question),
    }
  }

  /**
   * Validate AI tracker data
   */
  validate(data: AITrackerMetrics): boolean {
    if (!data) return false
    if (typeof data !== 'object') return false
    if (typeof data.tracked_questions !== 'number') return false
    return true
  }

  /**
   * Normalize raw data to AITrackerMetrics (interface implementation)
   */
  async normalize(data: any): Promise<AITrackerMetrics> {
    if (Array.isArray(data)) {
      return this.normalizeRuns(data)
    }
    return data as AITrackerMetrics
  }

  /**
   * Execute full collection pipeline
   */
  async execute(clientId: string, month: string): Promise<void> {
    // Collect
    const data = await this.collect(clientId, month)
    if (!data) {
      console.log(`No AI tracker data for client ${clientId} in month ${month}`)
      return
    }

    // Validate
    if (!this.validate(data)) {
      throw new Error('Invalid AI tracker data')
    }

    // Normalize
    const normalized = await this.normalize(data)

    // Update report
    const reportId = await this.updateReport(clientId, month, {
      ai_avg_ranking: normalized.avg_ranking,
      ai_ranking_change: normalized.ranking_change,
      ai_tracked_questions: normalized.tracked_questions,
    })

    // Store section (with full details)
    await this.storeSection(reportId, normalized)
  }
}
