import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const clientId = 'c0000000-0000-0000-0000-000000000000'

  // Get all successful runs
  const { data: runs, error: runsError } = await supabaseAdmin
    .from('ai_visibility_runs')
    .select('id, query_id, ai_engine, raw_response, brands_mentioned, ran_at, error_message')
    .eq('client_id', clientId)
    .is('error_message', null)
    .order('ran_at', { ascending: false })

  if (runsError || !runs) {
    return NextResponse.json({ error: 'Failed to fetch runs' }, { status: 500 })
  }

  // Get all queries
  const queryIds = Array.from(new Set(runs.map((r) => r.query_id)))
  const { data: queries } = await supabaseAdmin.from('ai_visibility_queries').select('id, question')

  const queryMap = Object.fromEntries(queries?.map((q) => [q.id, q.question]) || [])

  // Categorize by question type
  const brandFocused = [
    'best China tour companies',
    'Which China tour operator',
    'tour operator',
    'tour specialists',
    'tour packages',
    'reviews from New Zealand',
    'Wendy Wu',
    'coach tours',
  ]

  const analysis = runs.map((r) => {
    const question = queryMap[r.query_id] || 'Unknown'
    const isBrandQuestion = brandFocused.some((keyword) => question.toLowerCase().includes(keyword.toLowerCase()))
    const responseStart = r.raw_response?.substring(0, 200) || null

    return {
      engine: r.ai_engine,
      question,
      isBrandQuestion,
      brandsExtracted: r.brands_mentioned || [],
      brandsCount: Array.isArray(r.brands_mentioned) ? r.brands_mentioned.length : 0,
      responseLength: r.raw_response?.length || 0,
      responseStart,
    }
  })

  const brandQuestions = analysis.filter((a) => a.isBrandQuestion)
  const generalQuestions = analysis.filter((a) => !a.isBrandQuestion)

  return NextResponse.json({
    total: runs.length,
    summary: {
      brandQuestionRuns: brandQuestions.length,
      generalQuestionRuns: generalQuestions.length,
      brandRunsWithExtraction: brandQuestions.filter((a) => a.brandsCount > 0).length,
      generalRunsWithExtraction: generalQuestions.filter((a) => a.brandsCount > 0).length,
    },
    brandQuestionSamples: brandQuestions.slice(0, 5),
    generalQuestionSamples: generalQuestions.slice(0, 3),
  })
}
