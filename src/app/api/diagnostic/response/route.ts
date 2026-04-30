import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(request: Request) {
  const clientId = 'c0000000-0000-0000-0000-000000000000'
  const { searchParams } = new URL(request.url)
  const question = searchParams.get('question') || 'What are the best China tour companies for New Zealand travellers in 2026?'

  const { data: runs, error } = await supabaseAdmin
    .from('ai_visibility_runs')
    .select('ai_engine, raw_response, brands_mentioned, error_message, query_id')
    .eq('client_id', clientId)
    .is('error_message', null)
    .limit(1)
    .order('ran_at', { ascending: false })

  if (error || !runs || runs.length === 0) {
    return NextResponse.json({ error: 'No runs found' }, { status: 404 })
  }

  const run = runs[0]

  // Get query to show what question this is
  const { data: queries } = await supabaseAdmin
    .from('ai_visibility_queries')
    .select('question')
    .eq('id', run.query_id)
    .single()

  return NextResponse.json({
    engine: run.ai_engine,
    question: queries?.question,
    rawResponseLength: run.raw_response?.length || 0,
    rawResponse: run.raw_response,
    brandsExtracted: run.brands_mentioned,
    extractedCount: Array.isArray(run.brands_mentioned) ? run.brands_mentioned.length : 0,
  })
}
