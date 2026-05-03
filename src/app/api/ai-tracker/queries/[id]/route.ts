import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * PATCH /api/ai-tracker/queries/[id]
 *
 * Update a single AI Visibility query (enable/disable, edit question, notes).
 *
 * Body (all fields optional):
 * {
 *   enabled?: boolean
 *   question?: string
 *   notes?: string
 * }
 *
 * Reference: ROADMAP.md P7.1.16
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const queryId = params.id
    if (!queryId) {
      return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    }

    const body = (await req.json()) as {
      enabled?: boolean
      question?: string
      notes?: string
    }

    // Build update payload — only include defined fields
    const update: Record<string, unknown> = {}
    if (typeof body.enabled === 'boolean') update.enabled = body.enabled
    if (typeof body.question === 'string' && body.question.trim().length >= 10) {
      update.question = body.question.trim()
    }
    if (typeof body.notes === 'string') {
      update.notes = body.notes.trim() || null
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid fields to update' },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('ai_visibility_queries')
      .update(update)
      .eq('id', queryId)
      .select('*')
      .single()

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, query: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
