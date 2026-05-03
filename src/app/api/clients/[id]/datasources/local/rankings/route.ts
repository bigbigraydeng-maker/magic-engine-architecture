/**
 * Local Visibility rankings query endpoint
 * GET /api/clients/[id]/datasources/local/rankings
 *
 * Returns local pack rankings grouped by city
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

interface LocalRankingsByCity {
  city_name: string
  location_code: number
  country_code: string
  total: number
  top10: number
  top50: number
  rankings: Array<{
    id: string
    keyword: string
    position: number | null
    date: string
  }>
}

export async function GET(
  req: NextRequest,
  context: { params: { id: string } }
) {
  const { id: clientId } = context.params
  const searchParams = req.nextUrl.searchParams
  const limit = parseInt(searchParams.get('limit') || '100')
  const offset = parseInt(searchParams.get('offset') || '0')

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    )

    // Get latest snapshot date
    const { data: latestSnapshot } = await supabase
      .from('local_serp_rankings')
      .select('date')
      .eq('client_id', clientId)
      .order('date', { ascending: false })
      .limit(1)

    const latestDate = latestSnapshot?.[0]?.date

    if (!latestDate) {
      return NextResponse.json({
        rankingsByCity: [],
        trends: [],
        total: 0,
        latestDate: null,
      })
    }

    // Get all cities
    const { data: cities } = await supabase
      .from('local_cities')
      .select('location_code, city_name, country_code')

    // Get rankings by city
    const rankingsByCity: LocalRankingsByCity[] = []

    for (const city of cities || []) {
      const { data: rankings, count } = await supabase
        .from('local_serp_rankings')
        .select('*', { count: 'exact' })
        .eq('client_id', clientId)
        .eq('location_code', city.location_code)
        .eq('date', latestDate)
        .range(offset, offset + limit - 1)

      if (rankings && rankings.length > 0) {
        const top10 = rankings.filter((r) => r.position && r.position <= 10).length
        const top50 = rankings.filter((r) => r.position && r.position <= 50).length

        rankingsByCity.push({
          city_name: city.city_name,
          location_code: city.location_code,
          country_code: city.country_code,
          total: count || 0,
          top10,
          top50,
          rankings: rankings.map((r) => ({
            id: r.id,
            keyword: r.keyword,
            position: r.position,
            date: r.date,
          })),
        })
      }
    }

    // Get trend data
    const { data: trends } = await supabase
      .from('local_ranking_history')
      .select('*')
      .eq('client_id', clientId)
      .order('date_end', { ascending: false })
      .limit(1)

    return NextResponse.json({
      rankingsByCity,
      trends: trends || [],
      total: rankingsByCity.reduce((sum, city) => sum + city.total, 0),
      latestDate,
      pagination: {
        limit,
        offset,
      },
    })
  } catch (error) {
    console.error('Local rankings fetch error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch local rankings',
        rankingsByCity: [],
        trends: [],
        total: 0,
        latestDate: null,
      },
      { status: 500 }
    )
  }
}
