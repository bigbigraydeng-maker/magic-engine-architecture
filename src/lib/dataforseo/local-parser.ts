/**
 * Local Pack rankings parser and storage
 * Handles DataForSEO Local Pack API responses → Supabase
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'

interface LocalPackRanking {
  keyword: string
  location_code: number
  city_name: string
  country_code: string
  position: number | null
  title: string | null
  description: string | null
  url: string | null
}

interface LocalTrendData {
  keyword: string
  location_code: number
  city_name: string
  country_code: string
  position_start: number | null
  position_current: number | null
  position_change: number | null
  is_new: boolean
  is_lost: boolean
  date_start: string
  date_end: string
}

interface LocalMetrics {
  totalKeywords: number
  rankingTop10ByCity: Record<string, number>
  rankingTop50ByCity: Record<string, number>
  newOpportunitiesByCity: Record<string, number>
  lostRankingsByCity: Record<string, number>
  latestDate: string | null
}

/**
 * Store local pack rankings from DataForSEO API response
 * Upserts into local_serp_rankings table
 */
export async function storeLocalData(
  clientId: string,
  locationCode: number,
  cityName: string,
  countryCode: string,
  rankings: LocalPackRanking[],
  snapshotDate: string,
  supabase: SupabaseClient<any>
): Promise<number> {
  if (rankings.length === 0) return 0

  const recordsToInsert = rankings.map((rank) => ({
    client_id: clientId,
    keyword: rank.keyword,
    city_name: cityName,
    location_code: locationCode,
    country_code: countryCode,
    position: rank.position,
    date: snapshotDate,
  }))

  const { error, data } = await supabase
    .from('local_serp_rankings')
    .upsert(recordsToInsert, {
      onConflict: 'client_id,keyword,location_code,date',
    })

  if (error) {
    throw new Error(`Failed to store local rankings: ${error.message}`)
  }

  return (data as any)?.length || 0
}

/**
 * Calculate local ranking trends over 28-day window
 * Detects new and lost rankings by city
 */
export async function calculateLocalTrends(
  clientId: string,
  locationCode: string,
  cityName: string,
  countryCode: string,
  supabase: SupabaseClient<any>
): Promise<LocalTrendData[]> {
  const today = new Date()
  const thirtyDaysAgo = new Date(today)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const todayStr = today.toISOString().split('T')[0]
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0]

  // Get latest ranking for each keyword
  const { data: latestRankings } = await supabase
    .from('local_serp_rankings')
    .select('keyword, position')
    .eq('client_id', clientId)
    .eq('location_code', locationCode)
    .eq('date', todayStr)

  // Get ranking from 28 days ago
  const { data: oldRankings } = await supabase
    .from('local_serp_rankings')
    .select('keyword, position')
    .eq('client_id', clientId)
    .eq('location_code', locationCode)
    .eq('date', thirtyDaysAgoStr)

  const oldMap = new Map(oldRankings?.map((r) => [r.keyword, r.position]) || [])
  const trends: LocalTrendData[] = []

  for (const current of latestRankings || []) {
    const positionStart = oldMap.get(current.keyword) || null
    const positionCurrent = current.position
    const positionChange = positionStart && positionCurrent ? positionStart - positionCurrent : null
    const isNew = positionStart === null && positionCurrent !== null
    const isLost = positionStart !== null && positionCurrent === null

    if (positionChange !== null || isNew || isLost) {
      trends.push({
        keyword: current.keyword,
        location_code: locationCode as unknown as number,
        city_name: cityName,
        country_code: countryCode,
        position_start: positionStart,
        position_current: positionCurrent,
        position_change: positionChange,
        is_new: isNew,
        is_lost: isLost,
        date_start: thirtyDaysAgoStr,
        date_end: todayStr,
      })
    }
  }

  // Store trends
  if (trends.length > 0) {
    await supabase
      .from('local_ranking_history')
      .upsert(trends, {
        onConflict: 'client_id,keyword,location_code,date_end',
      })
  }

  return trends
}

/**
 * Get aggregated metrics for local rankings by city
 */
export async function getLocalMetrics(
  clientId: string,
  supabase: SupabaseClient<any>
): Promise<LocalMetrics> {
  // Get latest snapshot date
  const { data: latestSnapshot } = await supabase
    .from('local_serp_rankings')
    .select('date')
    .eq('client_id', clientId)
    .order('date', { ascending: false })
    .limit(1)

  const latestDate = latestSnapshot?.[0]?.date || null

  if (!latestDate) {
    return {
      totalKeywords: 0,
      rankingTop10ByCity: {},
      rankingTop50ByCity: {},
      newOpportunitiesByCity: {},
      lostRankingsByCity: {},
      latestDate: null,
    }
  }

  // Get all keywords for latest snapshot
  const { data: allRankings } = await supabase
    .from('local_serp_rankings')
    .select('city_name, position')
    .eq('client_id', clientId)
    .eq('date', latestDate)

  // Aggregate by city
  const rankingTop10ByCity: Record<string, number> = {}
  const rankingTop50ByCity: Record<string, number> = {}

  for (const rank of allRankings || []) {
    if (!rankingTop10ByCity[rank.city_name]) {
      rankingTop10ByCity[rank.city_name] = 0
      rankingTop50ByCity[rank.city_name] = 0
    }

    if (rank.position && rank.position <= 10) {
      rankingTop10ByCity[rank.city_name]++
    }
    if (rank.position && rank.position <= 50) {
      rankingTop50ByCity[rank.city_name]++
    }
  }

  // Get new opportunities and lost rankings from latest trend window
  const { data: latestTrends } = await supabase
    .from('local_ranking_history')
    .select('city_name, is_new, is_lost')
    .eq('client_id', clientId)
    .order('date_end', { ascending: false })
    .limit(1)

  const newOpportunitiesByCity: Record<string, number> = {}
  const lostRankingsByCity: Record<string, number> = {}

  for (const trend of latestTrends || []) {
    if (!newOpportunitiesByCity[trend.city_name]) {
      newOpportunitiesByCity[trend.city_name] = 0
      lostRankingsByCity[trend.city_name] = 0
    }

    if (trend.is_new) {
      newOpportunitiesByCity[trend.city_name]++
    }
    if (trend.is_lost) {
      lostRankingsByCity[trend.city_name]++
    }
  }

  return {
    totalKeywords: allRankings?.length || 0,
    rankingTop10ByCity,
    rankingTop50ByCity,
    newOpportunitiesByCity,
    lostRankingsByCity,
    latestDate,
  }
}
