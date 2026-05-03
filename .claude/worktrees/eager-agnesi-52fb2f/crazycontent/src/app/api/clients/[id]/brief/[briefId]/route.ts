import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

type RouteParams = { params: { id: string; briefId: string } }

/**
 * GET /api/clients/[id]/brief/[briefId]
 * Fetch a specific brief by ID.
 */
export async function GET(
  _req: NextRequest,
  { params }: RouteParams
) {
  try {
    const { data, error } = await supabaseAdmin
      .from('master_briefs')
      .select('*')
      .eq('id', params.briefId)
      .eq('client_id', params.id)
      .single()

    if (error) {
      const status = error.code === 'PGRST116' ? 404 : 500
      return NextResponse.json({ error: error.message }, { status })
    }

    return NextResponse.json({ brief: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * PATCH /api/clients/[id]/brief/[briefId]
 * Partial update of a brief (manual edits from the editor UI).
 * Accepts any subset of MasterBrief fields — status changes are NOT allowed here
 * (use /activate endpoint instead).
 */
export async function PATCH(
  req: NextRequest,
  { params }: RouteParams
) {
  try {
    const body = await req.json() as Record<string, unknown>

    // Prevent status changes through this endpoint
    delete body.status
    delete body.is_active
    delete body.client_id
    delete body.id
    delete body.version
    delete body.created_at

    const { data, error } = await supabaseAdmin
      .from('master_briefs')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', params.briefId)
      .eq('client_id', params.id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ brief: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * DELETE /api/clients/[id]/brief/[briefId]
 * Archives a brief (soft delete — sets status to 'archived').
 * Active briefs cannot be deleted; must deactivate first.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: RouteParams
) {
  try {
    // Refuse to archive the active brief
    const { data: current } = await supabaseAdmin
      .from('master_briefs')
      .select('status, is_active')
      .eq('id', params.briefId)
      .single()

    if (current?.status === 'active' || current?.is_active) {
      return NextResponse.json(
        { error: 'Cannot archive the active brief. Activate another brief first.' },
        { status: 409 }
      )
    }

    const { error } = await supabaseAdmin
      .from('master_briefs')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', params.briefId)
      .eq('client_id', params.id)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
