/**
 * GET /api/clients/[id]/execution
 *
 * Returns all execution_items for a client, optionally filtered by prescription_id.
 * Items are ordered by sort_order ascending (phase then action sequence).
 *
 * Query params:
 *   ?prescription_id=<uuid>  — filter to one prescription (optional)
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.5.17
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import type { ExecutionItem } from '@/types/diagnostic'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const { id: clientId } = params
    const { searchParams } = new URL(req.url)
    const prescriptionId = searchParams.get('prescription_id')

    let query = supabaseAdmin
      .from('execution_items')
      .select('*')
      .eq('client_id', clientId)
      .order('sort_order', { ascending: true })

    if (prescriptionId) {
      query = query.eq('prescription_id', prescriptionId)
    }

    const { data, error } = await query

    if (error) {
      console.error('[execution GET] Supabase error:', error)
      return NextResponse.json({ success: false, error: 'Failed to fetch execution items' }, { status: 500 })
    }

    const items = (data ?? []) as ExecutionItem[]
    return NextResponse.json({ success: true, items, count: items.length })
  } catch (err: unknown) {
    console.error('[execution GET] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}
