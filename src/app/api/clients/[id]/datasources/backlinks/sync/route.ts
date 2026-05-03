import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import DataForSeoClient from '@/lib/dataforseo/client'
import { storeBacklinkData } from '@/lib/dataforseo/backlinks-parser'

interface BacklinkResponse {
  url: string
  domain: string
  title?: string
  anchor: string
  tld_rank?: number
  citation_flow?: number
  trust_flow?: number
  last_seen?: string
  first_seen?: string
  type: 'do-follow' | 'no-follow' | 'internal'
  page_rank?: number
  image_alt?: string
  status_code?: number
}

// POST /api/clients/[id]/datasources/backlinks/sync
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Get client domain
    const { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .select('id, domain')
      .eq('id', params.id)
      .single()

    if (clientError) throw clientError
    if (!client?.domain) {
      return NextResponse.json({ error: 'Client domain not found' }, { status: 400 })
    }

    // Parse request body
    const body = await req.json()
    const limit = body.limit || 100
    const offset = body.offset || 0

    // Initialize DataForSEO client
    const dataforSeoClient = new DataForSeoClient()

    // Fetch backlinks and summary concurrently
    const [backlinksRes, summaryRes] = await Promise.all([
      dataforSeoClient.getBacklinks(client.domain, limit, offset),
      dataforSeoClient.getBacklinksSummary(client.domain),
    ])

    // Extract backlinks from response
    const backlinksTask = backlinksRes.tasks?.[0]
    if (!backlinksTask || backlinksTask.status_code !== 20000) {
      return NextResponse.json(
        { error: `DataForSEO backlinks failed: ${backlinksTask?.status_message}` },
        { status: 500 }
      )
    }

    const backlinks: BacklinkResponse[] = (backlinksTask.result as BacklinkResponse[]) || []

    // Extract summary from response
    const summaryTask = summaryRes.tasks?.[0]
    if (!summaryTask || summaryTask.status_code !== 20000) {
      return NextResponse.json(
        { error: `DataForSEO summary failed: ${summaryTask?.status_message}` },
        { status: 500 }
      )
    }

    const summaryData: Record<string, any> = summaryTask.result?.[0] || {}

    // Store in Supabase
    await storeBacklinkData(client.id, client.domain, backlinks, {
      backlinks: summaryData.backlinks,
      referring_domains: summaryData.referring_domains,
      referring_pages: summaryData.referring_pages,
      rank: summaryData.rank,
    })

    return NextResponse.json({
      success: true,
      domain: client.domain,
      backlinks_count: backlinks.length,
      total_backlinks: summaryData.backlinks || 0,
      referring_domains: summaryData.referring_domains || 0,
      referring_pages: summaryData.referring_pages || 0,
      rank: summaryData.rank || null,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[backlinks/sync] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
