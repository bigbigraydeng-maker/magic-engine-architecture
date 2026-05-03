import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type { GeoDirective } from '@/types/magic-engine'

/**
 * POST /api/clients/[id]/geo/deployments
 *
 * Record a URL where the GEO snippet has been deployed.
 * Appends to deployed_pages array of the active directive.
 *
 * Body:
 * {
 *   url: string             // the page URL where snippet was installed
 *   directive_id?: string   // defaults to active directive
 * }
 *
 * Reference: ROADMAP.md P7.2.10, ARCHITECTURE.md §11.4
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const clientId = params.id
    const body = (await req.json()) as { url?: string; directive_id?: string }

    if (!body.url || !body.url.startsWith('http')) {
      return NextResponse.json(
        { success: false, error: 'url is required and must start with http' },
        { status: 400 }
      )
    }

    // Find the target directive
    let directiveQuery = supabaseAdmin
      .from('geo_directives')
      .select('id, deployed_pages')
      .eq('client_id', clientId)

    if (body.directive_id) {
      directiveQuery = directiveQuery.eq('id', body.directive_id)
    } else {
      directiveQuery = directiveQuery.eq('status', 'active')
    }

    const { data: existing, error: fetchErr } = await directiveQuery
      .single<{ id: string; deployed_pages: string[] }>()

    if (fetchErr || !existing) {
      return NextResponse.json(
        { success: false, error: 'No active directive found for this client' },
        { status: 404 }
      )
    }

    // Append URL if not already present
    const currentPages = existing.deployed_pages ?? []
    if (currentPages.includes(body.url)) {
      return NextResponse.json({
        success: true,
        message: 'URL already recorded',
        deployed_pages: currentPages,
      })
    }

    const updatedPages = [...currentPages, body.url]

    const { data, error: updateErr } = await supabaseAdmin
      .from('geo_directives')
      .update({ deployed_pages: updatedPages })
      .eq('id', existing.id)
      .select('*')
      .single<GeoDirective>()

    if (updateErr) {
      return NextResponse.json(
        { success: false, error: updateErr.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      directive_id: existing.id,
      deployed_pages: data?.deployed_pages ?? updatedPages,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
