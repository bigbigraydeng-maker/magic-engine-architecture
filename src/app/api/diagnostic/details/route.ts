import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const clientId = 'c0000000-0000-0000-0000-000000000000'

  const { data: runs, error } = await supabaseAdmin
    .from('ai_visibility_runs')
    .select('id, query_id, ai_engine, raw_response, brands_mentioned, client_brand_rank, error_message')
    .eq('client_id', clientId)
    .is('error_message', null)
    .limit(2)
    .order('ran_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Get query text for context
  const queryIds = runs?.map((r) => r.query_id) || []
  const { data: queries } = await supabaseAdmin
    .from('ai_visibility_queries')
    .select('id, question')
    .in('id', queryIds)

  const queryMap = Object.fromEntries(queries?.map((q) => [q.id, q.question]) || [])

  // Format response
  const details = runs?.map((r) => ({
    engine: r.ai_engine,
    question: queryMap[r.query_id] || 'Unknown',
    rawResponseLength: r.raw_response?.length || 0,
    rawResponsePreview: r.raw_response?.substring(0, 300) || null,
    brandsExtracted: r.brands_mentioned,
    clientRank: r.client_brand_rank,
  })) || []

  return NextResponse.json({ details, count: details.length })
}
