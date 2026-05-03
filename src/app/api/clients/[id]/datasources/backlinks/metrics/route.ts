import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getBacklinkMetrics } from '@/lib/dataforseo/backlinks-parser'

// GET /api/clients/[id]/datasources/backlinks/metrics
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .select('id, domain')
      .eq('id', params.id)
      .single()

    if (clientError) throw clientError
    if (!client?.domain) {
      return NextResponse.json({ error: 'Client domain not found' }, { status: 400 })
    }

    const metrics = await getBacklinkMetrics(client.id, client.domain)

    return NextResponse.json({
      domain: client.domain,
      today: metrics.today,
      weekly: metrics.weekly,
      quality: metrics.quality,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[backlinks/metrics] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
