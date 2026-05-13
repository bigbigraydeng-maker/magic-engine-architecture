/**
 * PATCH /api/clients/[id]/execution/[itemId]
 *
 * Update execution item status and optional notes.
 *
 * Body: {
 *   status: 'completed' | 'in_progress' | 'skipped'
 *   notes?: string
 * }
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.5.17
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import type { ExecutionItem, ExecutionItemStatus } from '@/types/diagnostic'

const VALID_STATUSES: ExecutionItemStatus[] = ['completed', 'in_progress', 'skipped']

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } },
): Promise<NextResponse> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const { id: clientId, itemId } = params
    const body = (await req.json()) as { status?: ExecutionItemStatus; notes?: string }

    if (!body.status || !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { success: false, error: `status must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 },
      )
    }

    const patch: Record<string, unknown> = { status: body.status }
    if (body.status === 'completed') {
      patch.completed_at = new Date().toISOString()
    }
    if (body.notes !== undefined) {
      patch.notes = body.notes
    }

    const { data, error } = await supabaseAdmin
      .from('execution_items')
      .update(patch)
      .eq('id', itemId)
      .eq('client_id', clientId)
      .select('*')
      .single<ExecutionItem>()

    if (error || !data) {
      console.error('[execution/:itemId PATCH] Supabase error:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to update execution item' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, item: data })
  } catch (err: unknown) {
    console.error('[execution/:itemId PATCH] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}
