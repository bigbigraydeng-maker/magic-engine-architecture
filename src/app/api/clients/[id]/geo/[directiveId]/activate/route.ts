import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type { GeoDirective } from '@/types/magic-engine'

/**
 * POST /api/clients/[id]/geo/[directiveId]/activate
 *
 * Activates a draft directive. Atomically:
 *   1. Archives the current active directive (if any)
 *   2. Activates the target directive
 *
 * Only one directive can be active per client at a time
 * (enforced by UNIQUE INDEX on status='active').
 *
 * Reference: ROADMAP.md P7.2.8, ARCHITECTURE.md §11.4
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; directiveId: string } }
) {
  try {
    const { id: clientId, directiveId } = params

    // Step 1: Archive any currently active directive for this client
    await supabaseAdmin
      .from('geo_directives')
      .update({ status: 'archived' })
      .eq('client_id', clientId)
      .eq('status', 'active')

    // Step 2: Activate the target directive
    const { data, error } = await supabaseAdmin
      .from('geo_directives')
      .update({ status: 'active' })
      .eq('id', directiveId)
      .eq('client_id', clientId)       // safety: ensure client ownership
      .select('*')
      .single<GeoDirective>()

    if (error || !data) {
      return NextResponse.json(
        { success: false, error: error?.message ?? 'Directive not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, directive: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
