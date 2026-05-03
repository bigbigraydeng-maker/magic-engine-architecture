import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * Check if parser calls are failing by examining the pattern:
 * - If raw_response exists but brands_mentioned is empty,
 *   it suggests the parser failed silently
 */
export async function GET() {
  const clientId = 'c0000000-0000-0000-0000-000000000000'

  // Get all successful runner calls (no error_message)
  const { data: runs, error: runsError } = await supabaseAdmin
    .from('ai_visibility_runs')
    .select('id, query_id, ai_engine, raw_response, brands_mentioned, error_message')
    .eq('client_id', clientId)
    .is('error_message', null)
    .order('ran_at', { ascending: false })

  if (runsError || !runs) {
    return NextResponse.json({ error: 'Failed to fetch runs' }, { status: 500 })
  }

  // Categorize: successful parse vs likely silent failures
  const successfulParses = runs.filter(
    (r) => Array.isArray(r.brands_mentioned) && r.brands_mentioned.length > 0
  )

  const failedParses = runs.filter(
    (r) =>
      r.raw_response && // runner succeeded, produced output
      (!Array.isArray(r.brands_mentioned) || r.brands_mentioned.length === 0) // but no brands extracted
  )

  // Get query text for failed parses
  const failedQueryIds = failedParses.map((r) => r.query_id)
  const { data: queries } = await supabaseAdmin
    .from('ai_visibility_queries')
    .select('id, question')
    .in('id', failedQueryIds)

  const queryMap = Object.fromEntries(queries?.map((q) => [q.id, q.question]) || [])

  const failedWithContext = failedParses.map((r) => ({
    engine: r.ai_engine,
    question: queryMap[r.query_id] || 'Unknown',
    rawResponseLength: r.raw_response?.length || 0,
    rawResponseStart: r.raw_response?.substring(0, 150) || null,
  }))

  return NextResponse.json({
    summary: {
      totalRuns: runs.length,
      successfulParses: successfulParses.length,
      failedParses: failedParses.length,
      parserSuccessRate: runs.length > 0 ? ((successfulParses.length / runs.length) * 100).toFixed(1) + '%' : 'N/A',
    },
    failedParseExamples: failedWithContext.slice(0, 5),
  })
}
