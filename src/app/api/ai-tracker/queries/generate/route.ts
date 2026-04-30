import { NextRequest, NextResponse } from 'next/server'
import { generateQuestionsForClient } from '@/lib/ai-tracker/question-generator'
import { supabaseAdmin } from '@/lib/supabase'
import type {
  GenerateQuestionsRequest,
  AiVisibilityQuery,
} from '@/types/magic-engine'

/**
 * POST /api/ai-tracker/queries/generate
 *
 * Generates 10-25 industry questions via Strategy Engine and persists them
 * to ai_visibility_queries with source='auto_generated'.
 *
 * Reference: ROADMAP.md P7.1.3, ARCHITECTURE.md §12.3
 *
 * Body: GenerateQuestionsRequest
 * {
 *   client_id: string         // required
 *   count?: number            // default 18, range 10-25
 *   market?: 'au'|'nz'|'au-nz'|'global'  // default 'au-nz'
 *   context_hint?: string     // optional steering hint
 * }
 *
 * Response on success:
 * {
 *   success: true,
 *   inserted_count: number,
 *   queries: AiVisibilityQuery[],
 *   cost_usd: number,
 *   input_tokens: number,
 *   output_tokens: number
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<GenerateQuestionsRequest>

    if (!body.client_id) {
      return NextResponse.json(
        { success: false, error: 'client_id is required' },
        { status: 400 }
      )
    }

    // 1. Generate questions via Strategy Engine
    const result = await generateQuestionsForClient({
      client_id: body.client_id,
      count: body.count,
      market: body.market,
      context_hint: body.context_hint,
    })

    // 2. Bulk insert into ai_visibility_queries
    const rows = result.questions.map(q => ({
      client_id: body.client_id!,
      question: q.question,
      source: 'auto_generated' as const,
      enabled: true,
      market_tag: q.market_tag,
      notes: q.rationale,
    }))

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('ai_visibility_queries')
      .insert(rows)
      .select('*')

    if (insertErr) {
      return NextResponse.json(
        {
          success: false,
          error: `Failed to persist queries: ${insertErr.message}`,
          generated_count: result.questions.length,
          cost_usd: result.cost_usd,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      inserted_count: inserted?.length ?? 0,
      queries: (inserted ?? []) as AiVisibilityQuery[],
      cost_usd: result.cost_usd,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}
