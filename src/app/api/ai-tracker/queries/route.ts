import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type {
  AiVisibilityQuery,
  AiQuerySource,
  MarketTag,
} from '@/types/magic-engine'

/**
 * GET /api/ai-tracker/queries?client_id=...&enabled_only=true
 *
 * Lists AI Visibility queries for a client, ordered by created_at DESC.
 * Optional filter: ?enabled_only=true returns only enabled questions.
 *
 * Reference: ROADMAP.md P7.1.3
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const clientId = url.searchParams.get('client_id')
    const enabledOnly = url.searchParams.get('enabled_only') === 'true'

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: 'client_id query parameter is required' },
        { status: 400 }
      )
    }

    let query = supabaseAdmin
      .from('ai_visibility_queries')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })

    if (enabledOnly) {
      query = query.eq('enabled', true)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      queries: (data ?? []) as AiVisibilityQuery[],
      count: data?.length ?? 0,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}

interface ManualQueryBody {
  client_id: string
  question: string
  market_tag?: MarketTag
  notes?: string
  enabled?: boolean
}

/**
 * POST /api/ai-tracker/queries
 *
 * Manually add a single query (source='manual'). Use this when the
 * operator wants to add a custom question instead of (or in addition to)
 * auto-generated ones.
 *
 * Body: ManualQueryBody
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<ManualQueryBody>

    if (!body.client_id) {
      return NextResponse.json(
        { success: false, error: 'client_id is required' },
        { status: 400 }
      )
    }
    if (!body.question || body.question.trim().length < 10) {
      return NextResponse.json(
        {
          success: false,
          error: 'question is required and must be at least 10 characters',
        },
        { status: 400 }
      )
    }

    const row = {
      client_id: body.client_id,
      question: body.question.trim(),
      source: 'manual' as AiQuerySource,
      enabled: body.enabled ?? true,
      market_tag: body.market_tag ?? null,
      notes: body.notes?.trim() || null,
    }

    const { data, error } = await supabaseAdmin
      .from('ai_visibility_queries')
      .insert(row)
      .select('*')
      .single()

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      query: data as AiVisibilityQuery,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}
