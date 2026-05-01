import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type { GeoDirective } from '@/types/magic-engine'

/**
 * GET /api/clients/[id]/geo
 *
 * Returns all GEO directives for a client, ordered newest first.
 * Includes active, draft, and archived.
 *
 * Reference: ROADMAP.md P7.2.6, ARCHITECTURE.md §11.4
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const clientId = params.id

    const { data, error } = await supabaseAdmin
      .from('geo_directives')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    const directives = (data ?? []) as GeoDirective[]
    const active = directives.find(d => d.status === 'active') ?? null

    return NextResponse.json({
      success: true,
      directives,
      active,
      count: directives.length,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
