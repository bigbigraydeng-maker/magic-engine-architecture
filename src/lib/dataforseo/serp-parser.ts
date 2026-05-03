/**
 * SERP ranking data parser
 * Transforms DataForSEO Rank Tracker responses into Supabase records
 */

import { createClient } from '@supabase/supabase-js'

interface SerpRankingRecord {
  keyword: string
  position: number | null
  search_volume: number | null
  url: string | null
  snippet: string | null
  date: string
}

interface SerpRankingData {
  keyword: string
  position: number | null
  search_volume?: number | null
  url?: string | null
  snippet?: string | null
}

/**
 * Store SERP ranking data to Supabase
 */
export async function storeSerpiData(
  clientId: string,
  rankings: SerpRankingData[],
  snapshotDate: string
) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  )

  const records: SerpRankingRecord[] = rankings.map((r) => ({
    keyword: r.keyword,
    position: r.position || null,
    search_volume: r.search_volume || null,
    url: r.url || null,
    snippet: r.snippet || null,
    date: snapshotDate,
  }))

  // Upsert each ranking record (one per keyword per date)
  const { error } = await supabase
    .from('serp_rankings')
    .upsert(
      records.map((r) => ({
        client_id: clientId,
        ...r,
      })),
      { onConflict: 'client_id, keyword, date' }
    )

  if (error) {
    console.error('Error storing SERP data:', error)
    throw new Error(`Failed to store SERP rankings: ${error.message}`)
  }

  return records.length
}

/**
 * Calculate ranking trends (position change over time)
 */
export async function calculateSerpTrends(
  clientId: string,
  windowDays: number = 28
) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  )

  const endDate = new Date().toISOString().split('T')[0]
  const startDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]

  // Get all keywords for this client
  const { data: allKeywords, error: keywordError } = await supabase
    .from('serp_rankings')
    .select('keyword')
    .eq('client_id', clientId)
    .gte('date', startDate)

  if (keywordError) throw keywordError

  const keywords = Array.from(new Set(allKeywords?.map((k) => k.keyword) || []))

  // For each keyword, calculate trend
  const trends = []
  for (const keyword of keywords) {
    // Get earliest and latest positions in window
    const { data: earliest } = await supabase
      .from('serp_rankings')
      .select('position, date')
      .eq('client_id', clientId)
      .eq('keyword', keyword)
      .gte('date', startDate)
      .order('date', { ascending: true })
      .limit(1)

    const { data: latest } = await supabase
      .from('serp_rankings')
      .select('position, date')
      .eq('client_id', clientId)
      .eq('keyword', keyword)
      .order('date', { ascending: false })
      .limit(1)

    if (earliest && latest && earliest.length > 0 && latest.length > 0) {
      const posStart = earliest[0].position
      const posCurrent = latest[0].position

      // Detect new / lost
      const isNew = posStart === null && posCurrent !== null
      const isLost = posStart !== null && posCurrent === null
      const posChange = posCurrent !== null && posStart !== null
        ? posStart - posCurrent
        : null

      trends.push({
        client_id: clientId,
        keyword,
        position_start: posStart,
        position_current: posCurrent,
        position_change: posChange,
        date_start: startDate,
        date_end: endDate,
        is_new: isNew,
        is_lost: isLost,
      })
    }
  }

  // Upsert trend data
  if (trends.length > 0) {
    const { error: trendError } = await supabase
      .from('serp_ranking_history')
      .upsert(trends, { onConflict: 'client_id, keyword, date_end' })

    if (trendError) {
      console.error('Error storing SERP trends:', trendError)
      throw new Error(`Failed to store trends: ${trendError.message}`)
    }
  }

  return trends
}

/**
 * Get SERP metrics for dashboard
 */
export async function getSerpMetrics(clientId: string) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  )

  // Latest date snapshot
  const { data: latestSnapshot } = await supabase
    .from('serp_rankings')
    .select('date')
    .eq('client_id', clientId)
    .order('date', { ascending: false })
    .limit(1)

  const latestDate = latestSnapshot?.[0]?.date

  if (!latestDate) {
    return {
      totalKeywords: 0,
      rankingTop10: 0,
      rankingTop50: 0,
      notRanking: 0,
      latestDate: null,
    }
  }

  // Count positions in latest snapshot
  const { data: latest } = await supabase
    .from('serp_rankings')
    .select('position')
    .eq('client_id', clientId)
    .eq('date', latestDate)

  const totalKeywords = latest?.length || 0
  const rankingTop10 = latest?.filter((r) => r.position && r.position <= 10).length || 0
  const rankingTop50 = latest?.filter((r) => r.position && r.position <= 50).length || 0
  const notRanking = latest?.filter((r) => !r.position).length || 0

  return {
    totalKeywords,
    rankingTop10,
    rankingTop50,
    notRanking,
    latestDate,
  }
}
