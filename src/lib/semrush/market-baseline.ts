/**
 * Market Baseline analysis - Industry benchmark data
 * Compare client's performance against industry average
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { batchKeywordOverview } from './client'

interface KeywordBaseline {
  keyword: string
  industry_avg_position: number | null
  industry_avg_volume: number
  top_10_domains: string[]
  difficulty_score: number
}

interface MarketComparison {
  keyword: string
  client_position: number | null
  industry_avg_position: number | null
  position_diff: number | null
  client_volume: number | null
  industry_avg_volume: number
  volume_percentile: number | null
  client_ranking_strength: 'ahead' | 'aligned' | 'behind' | 'not_ranking'
  opportunity_score: number
}

/**
 * Get industry baseline data for keywords
 * Uses Semrush API to gather top competitors and average metrics
 */
export async function getIndustryBaseline(
  keywords: string[],
  database: string,
  supabase: SupabaseClient<any>
): Promise<KeywordBaseline[]> {
  if (keywords.length === 0) return []

  // Get Semrush keyword data for industry overview
  const semrushData = await batchKeywordOverview(keywords, database)

  return semrushData.map((data) => ({
    keyword: data.keyword,
    industry_avg_position: null, // Semrush doesn't provide average position
    industry_avg_volume: data.volume,
    top_10_domains: [], // Would need domain_rank_data for this
    difficulty_score: data.kd,
  }))
}

/**
 * Calculate market comparison between client and industry
 */
export async function calculateMarketComparison(
  clientId: string,
  keywords: string[],
  clientData: Map<string, { position: number | null; volume: number | null }>,
  industryBaseline: KeywordBaseline[],
  supabase: SupabaseClient<any>
): Promise<MarketComparison[]> {
  const comparisons: MarketComparison[] = []

  for (const baseline of industryBaseline) {
    const client = clientData.get(baseline.keyword)

    const positionDiff = client?.position && baseline.industry_avg_position
      ? baseline.industry_avg_position - client.position
      : null

    const volumePercentile = client?.volume && baseline.industry_avg_volume
      ? (client.volume / baseline.industry_avg_volume) * 100
      : null

    let rankingStrength: 'ahead' | 'aligned' | 'behind' | 'not_ranking'
    if (!client?.position) {
      rankingStrength = 'not_ranking'
    } else if (positionDiff && positionDiff > 5) {
      rankingStrength = 'ahead'
    } else if (positionDiff && positionDiff < -5) {
      rankingStrength = 'behind'
    } else {
      rankingStrength = 'aligned'
    }

    // Opportunity score: higher if behind market avg and keyword has volume
    let opportunityScore = 0
    if (client?.position) {
      // Position-based: -50 to +50
      const positionScore = positionDiff ? Math.min(50, Math.max(-50, positionDiff)) : 0
      // Volume-based: 0 to 50
      const volumeScore = Math.min(50, (baseline.industry_avg_volume / 10000) * 50)
      // Difficulty-based: 0 to 30 (easy keywords = higher opportunity)
      const difficultyScore = Math.max(0, 30 - baseline.difficulty_score * 0.3)

      opportunityScore = Math.max(0, Math.min(100, positionScore + volumeScore + difficultyScore))
    }

    comparisons.push({
      keyword: baseline.keyword,
      client_position: client?.position || null,
      industry_avg_position: baseline.industry_avg_position,
      position_diff: positionDiff,
      client_volume: client?.volume || null,
      industry_avg_volume: baseline.industry_avg_volume,
      volume_percentile: volumePercentile,
      client_ranking_strength: rankingStrength,
      opportunity_score: opportunityScore,
    })
  }

  return comparisons
}

/**
 * Store market baseline snapshots
 */
export async function storeMarketBaseline(
  clientId: string,
  baseline: KeywordBaseline[],
  snapshotDate: string,
  supabase: SupabaseClient<any>
): Promise<number> {
  if (baseline.length === 0) return 0

  const recordsToInsert = baseline.map((b) => ({
    client_id: clientId,
    keyword: b.keyword,
    industry_avg_position: b.industry_avg_position,
    industry_avg_volume: b.industry_avg_volume,
    top_10_domains: b.top_10_domains,
    difficulty_score: b.difficulty_score,
    date: snapshotDate,
  }))

  const { error, data } = await supabase
    .from('market_baseline')
    .upsert(recordsToInsert, {
      onConflict: 'client_id,keyword,date',
    })

  if (error) {
    throw new Error(`Failed to store market baseline: ${error.message}`)
  }

  return (data as any)?.length || 0
}

/**
 * Store market comparison results
 */
export async function storeMarketComparison(
  clientId: string,
  comparisons: MarketComparison[],
  snapshotDate: string,
  supabase: SupabaseClient<any>
): Promise<number> {
  if (comparisons.length === 0) return 0

  const recordsToInsert = comparisons.map((c) => ({
    client_id: clientId,
    keyword: c.keyword,
    client_position: c.client_position,
    industry_avg_position: c.industry_avg_position,
    position_diff: c.position_diff,
    client_volume: c.client_volume,
    industry_avg_volume: c.industry_avg_volume,
    volume_percentile: c.volume_percentile,
    client_ranking_strength: c.client_ranking_strength,
    opportunity_score: c.opportunity_score,
    date: snapshotDate,
  }))

  const { error, data } = await supabase
    .from('market_comparison')
    .upsert(recordsToInsert, {
      onConflict: 'client_id,keyword,date',
    })

  if (error) {
    throw new Error(`Failed to store market comparison: ${error.message}`)
  }

  return (data as any)?.length || 0
}

/**
 * Get market metrics for dashboard (top opportunities, underperformers, etc)
 */
export async function getMarketMetrics(
  clientId: string,
  supabase: SupabaseClient<any>
) {
  const today = new Date().toISOString().split('T')[0]

  const { data: comparisons } = await supabase
    .from('market_comparison')
    .select('*')
    .eq('client_id', clientId)
    .eq('date', today)

  if (!comparisons || comparisons.length === 0) {
    return {
      topOpportunities: [],
      underperformers: [],
      aligned: [],
      avgOpportunityScore: 0,
      totalKeywords: 0,
    }
  }

  const topOpportunities = comparisons
    .filter((c) => c.opportunity_score > 60)
    .sort((a, b) => b.opportunity_score - a.opportunity_score)
    .slice(0, 10)

  const underperformers = comparisons
    .filter((c) => c.client_ranking_strength === 'behind' && c.client_position)
    .sort((a, b) => (b.position_diff || 0) - (a.position_diff || 0))
    .slice(0, 10)

  const aligned = comparisons.filter((c) => c.client_ranking_strength === 'aligned')

  const avgOpportunityScore =
    comparisons.reduce((sum, c) => sum + c.opportunity_score, 0) / comparisons.length

  return {
    topOpportunities,
    underperformers,
    aligned,
    avgOpportunityScore: Math.round(avgOpportunityScore),
    totalKeywords: comparisons.length,
  }
}
