import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { DataForSeoClient } from '@/lib/dataforseo/client'
import { parseClientRankings } from '@/lib/dataforseo/client-parser'
import { batchKeywordOverview } from '@/lib/semrush/client'
import {
  getIndustryBaseline,
  calculateMarketComparison,
  storeMarketBaseline,
  storeMarketComparison,
} from '@/lib/semrush/market-baseline'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: clientId } = await params

    // Get client domain from Supabase
    const { data: client } = await supabase
      .from('clients')
      .select('domain')
      .eq('id', clientId)
      .single()

    if (!client?.domain) {
      return NextResponse.json(
        { error: 'Client domain not found' },
        { status: 404 }
      )
    }

    // Get tracked keywords for this client
    const { data: rankings } = await supabase
      .from('client_serp_rankings')
      .select('keyword')
      .eq('client_id', clientId)
      .distinct()
      .limit(100)

    if (!rankings || rankings.length === 0) {
      return NextResponse.json(
        {
          success: true,
          recordsStored: 0,
          comparisonsStored: 0,
          message: 'No keywords tracked yet',
          snapshotDate: new Date().toISOString().split('T')[0],
        }
      )
    }

    const keywords = rankings.map((r: any) => r.keyword)
    const snapshotDate = new Date().toISOString().split('T')[0]

    // Get industry baseline from Semrush
    const baseline = await getIndustryBaseline(
      keywords,
      'au', // Database code for Australia (primary market)
      supabase
    )

    // Get client's current ranking data
    const { data: clientRankings } = await supabase
      .from('client_serp_rankings')
      .select('keyword, position, search_volume')
      .eq('client_id', clientId)
      .in(
        'keyword',
        keywords
      )

    const clientData = new Map(
      (clientRankings || []).map((r: any) => [
        r.keyword,
        { position: r.position, volume: r.search_volume },
      ])
    )

    // Calculate market comparison
    const comparisons = await calculateMarketComparison(
      clientId,
      keywords,
      clientData,
      baseline,
      supabase
    )

    // Store baseline and comparisons
    const baselineCount = await storeMarketBaseline(
      clientId,
      baseline,
      snapshotDate,
      supabase
    )

    const comparisonCount = await storeMarketComparison(
      clientId,
      comparisons,
      snapshotDate,
      supabase
    )

    return NextResponse.json({
      success: true,
      recordsStored: baselineCount,
      comparisonsStored: comparisonCount,
      snapshotDate,
      keywordsAnalyzed: keywords.length,
    })
  } catch (error) {
    console.error('Failed to sync market baseline:', error)
    return NextResponse.json(
      { error: 'Failed to sync market baseline' },
      { status: 500 }
    )
  }
}
