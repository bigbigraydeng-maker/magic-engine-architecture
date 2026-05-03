/**
 * SERP Intelligence sync endpoint
 * POST /api/clients/[id]/datasources/serp/sync
 *
 * Syncs keyword rankings from DataForSEO Rank Tracker
 * Stores rankings snapshot by date, calculates trends
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import DataForSeoClient from '@/lib/dataforseo/client'
import { storeSerpiData, calculateSerpTrends, getSerpMetrics } from '@/lib/dataforseo/serp-parser'

interface SyncRequestBody {
  keywords?: string[]
  limit?: number
  offset?: number
}

export async function POST(
  req: NextRequest,
  context: { params: { id: string } }
) {
  const { id: clientId } = context.params
  const body: SyncRequestBody = await req.json()
  const { keywords = [], limit = 100, offset = 0 } = body

  try {
    // Verify client exists
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    )

    const { data: client } = await supabase
      .from('clients')
      .select('id, domain')
      .eq('id', clientId)
      .single()

    if (!client?.domain) {
      return NextResponse.json(
        { error: 'Client not found or domain missing' },
        { status: 404 }
      )
    }

    // Get SERP data from DataForSEO
    const dataForSeo = new DataForSeoClient()
    const response = await dataForSeo.getSerp(client.domain, limit, offset)

    // Parse response and extract rankings
    const rankings = []
    const tasks = response.tasks || []

    for (const task of tasks) {
      if (task.result && Array.isArray(task.result)) {
        for (const result of task.result) {
          rankings.push({
            keyword: (result as any).keyword || '',
            position: (result as any).position || null,
            search_volume: (result as any).search_volume || null,
            url: (result as any).url || null,
            snippet: (result as any).snippet || null,
          })
        }
      }
    }

    // Store rankings snapshot
    const snapshotDate = new Date().toISOString().split('T')[0]
    const recordsStored = await storeSerpiData(clientId, rankings, snapshotDate)

    // Calculate trends
    const trends = await calculateSerpTrends(clientId, 28)

    // Get metrics
    const metrics = await getSerpMetrics(clientId)

    return NextResponse.json({
      success: true,
      message: `Synced ${recordsStored} keyword rankings`,
      data: {
        recordsStored,
        trendsCalculated: trends.length,
        metrics,
        snapshotDate,
      },
    })
  } catch (error) {
    console.error('SERP sync error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to sync SERP data',
      },
      { status: 500 }
    )
  }
}
