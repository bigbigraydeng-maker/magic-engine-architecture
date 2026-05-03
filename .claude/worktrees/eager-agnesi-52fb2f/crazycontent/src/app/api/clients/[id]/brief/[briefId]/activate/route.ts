import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * POST /api/clients/[id]/brief/[briefId]/activate
 *
 * Atomically switches the active brief for a client:
 * 1. Archives all other briefs for this client
 * 2. Sets the target brief to status='active'
 *
 * The partial unique index on master_briefs enforces only one active per client.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; briefId: string } }
) {
  try {
    // Verify the brief belongs to this client
    const { data: target, error: fetchError } = await supabaseAdmin
      .from('master_briefs')
      .select('id, status')
      .eq('id', params.briefId)
      .eq('client_id', params.id)
      .single()

    if (fetchError || !target) {
      return NextResponse.json({ error: 'Brief not found' }, { status: 404 })
    }

    if (target.status === 'active') {
      return NextResponse.json({ message: 'Already active' })
    }

    // Archive all other briefs for this client
    await supabaseAdmin
      .from('master_briefs')
      .update({ status: 'archived', is_active: false, updated_at: new Date().toISOString() })
      .eq('client_id', params.id)
      .neq('id', params.briefId)

    // Activate the target brief
    const { data: activated, error: activateError } = await supabaseAdmin
      .from('master_briefs')
      .update({ status: 'active', is_active: true, updated_at: new Date().toISOString() })
      .eq('id', params.briefId)
      .select()
      .single()

    if (activateError) throw activateError

    return NextResponse.json({ success: true, brief: activated })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
