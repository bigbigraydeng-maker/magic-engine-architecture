/**
 * SERP Intelligence rankings endpoint
 * GET /api/clients/[id]/datasources/serp/rankings
 *
 * Returns keyword rankings with trends for the client
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(
  req: NextRequest,
  context: { params: { id: string } }
) {
  const { id: clientId } = context.params
  const searchParams = req.nextUrl.searchParams
  const limit = parseInt(searchParams.get('limit') || '100')
  const offset = parseInt(searchParams.get('offset') || '0')
  const sortBy = searchParams.get('sortBy') || 'position'
  const sortOrder = searchParams.get('sortOrder') || 'asc'

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    )

    // Get latest snapshot date
    const { data: latestSnapshot } = await supabase
      .from('serp_rankings')
      .select('date')
      .eq('client_id', clientId)
      .order('date', { ascending: false })
      .limit(1)

    const latestDate = latestSnapshot?.[0]?.date

    if (!latestDate) {
      return NextResponse.json({
        rankings: [],
        trends: [],
        total: 0,
        latestDate: null,
      })
    }

    // Get rankings from latest snapshot
    let query = supabase
      .from('serp_rankings')
      .select('*', { count: 'exact' })
      .eq('client_id', clientId)
      .eq('date', latestDate)

    // Apply sorting
    if (sortBy === 'keyword') {
      query = query.order('keyword', { ascending: sortOrder === 'asc' })
    } else if (sortBy === 'position') {
      query = query.order('position', { ascending: sortOrder === 'asc', nullsFirst: false })
    } else if (sortBy === 'search_volume') {
      query = query.order('search_volume', { ascending: sortOrder === 'asc', nullsFirst: false })
    }

    query = query.range(offset, offset + limit - 1)

    const { data: rankings, count } = await query

    // Get trend data for these keywords
    const { data: trends } = await supabase
      .from('serp_ranking_history')
      .select('*')
      .eq('client_id', clientId)
      .order('date_end', { ascending: false })
      .limit(1)

    return NextResponse.json({
      rankings: rankings || [],
      trends: trends || [],
      total: count || 0,
      latestDate,
      pagination: {
        limit,
        offset,
        hasMore: (offset + limit) < (count || 0),
      },
    })
  } catch (error) {
    console.error('SERP rankings fetch error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch SERP rankings',
        rankings: [],
        trends: [],
        total: 0,
        latestDate: null,
      },
      { status: 500 }
    )
  }
}
