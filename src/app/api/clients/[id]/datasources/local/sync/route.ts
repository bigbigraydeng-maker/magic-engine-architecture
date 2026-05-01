/**
 * Local Visibility sync endpoint
 * POST /api/clients/[id]/datasources/local/sync
 *
 * Syncs local pack rankings from DataForSEO for all AU/NZ cities
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import DataForSeoClient from '@/lib/dataforseo/client'
import {
  storeLocalData,
  calculateLocalTrends,
  getLocalMetrics,
} from '@/lib/dataforseo/local-parser'

interface LocalPackResult {
  keyword: string
  location_code: number
  location_name: string
  position: number | null
  title: string | null
  description: string | null
  url: string | null
}

export async function POST(
  req: NextRequest,
  context: { params: { id: string } }
) {
  const { id: clientId } = context.params
  const body = await req.json().catch(() => ({}))
  const limit = body.limit || 100

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    )

    // Get client domain
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

    // Get list of cities to sync
    const { data: cities } = await supabase
      .from('local_cities')
      .select('location_code, city_name, country_code')

    if (!cities || cities.length === 0) {
      return NextResponse.json(
        { error: 'No cities configured' },
        { status: 400 }
      )
    }

    const dataforseo = new DataForSeoClient()
    const snapshotDate = new Date().toISOString().split('T')[0]
    let totalRecordsStored = 0
    let totalTrendsCalculated = 0

    // Sync each city
    for (const city of cities) {
      try {
        const response = await dataforseo.getLocal(
          client.domain,
          city.location_code,
          limit
        )

        // Extract rankings from DataForSEO response
        const rankings: LocalPackResult[] = []
        for (const task of response.tasks || []) {
          if (task.result) {
            rankings.push(...task.result)
          }
        }

        // Store rankings
        const stored = await storeLocalData(
          clientId,
          city.location_code,
          city.city_name,
          city.country_code,
          rankings.map((r) => ({
            keyword: r.keyword,
            location_code: r.location_code,
            city_name: r.location_name,
            country_code: city.country_code,
            position: r.position,
            title: r.title,
            description: r.description,
            url: r.url,
          })),
          snapshotDate,
          supabase
        )

        totalRecordsStored += stored

        // Calculate trends for this city
        const trends = await calculateLocalTrends(
          clientId,
          city.location_code.toString(),
          city.city_name,
          city.country_code,
          supabase
        )

        totalTrendsCalculated += trends.length
      } catch (cityError) {
        console.error(`Failed to sync city ${city.city_name}:`, cityError)
        // Continue with next city on error
      }
    }

    // Get aggregated metrics
    const metrics = await getLocalMetrics(clientId, supabase)

    return NextResponse.json({
      success: true,
      recordsStored: totalRecordsStored,
      trendsCalculated: totalTrendsCalculated,
      metrics,
      snapshotDate,
    })
  } catch (error) {
    console.error('Local sync error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to sync local rankings',
      },
      { status: 500 }
    )
  }
}
