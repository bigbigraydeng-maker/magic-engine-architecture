import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const SELECT_FIELDS = [
  'id', 'name', 'domain', 'created_at', 'semrush_db', 'plan_tier',
  'airtable_base_id', 'airtable_content_table_id', 'airtable_keywords_table_id',
  'airtable_embed_social', 'airtable_embed_keywords', 'airtable_embed_seo',
].join(', ')

// GET /api/clients/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select(SELECT_FIELDS)
      .eq('id', params.id)
      .single()

    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ client: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// DELETE /api/clients/[id]
// TODO(P8.3.2): replace this origin guard with Magic Link session auth
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Minimal SSRF / external-caller guard until proper session auth lands (P8.3.2).
  // Only allow requests that originate from the same app host.
  const host = req.headers.get('host') ?? ''
  const origin = req.headers.get('origin') ?? ''
  const referer = req.headers.get('referer') ?? ''
  const callerOk =
    (origin && (origin.includes(host) || origin.includes('localhost'))) ||
    (referer && (referer.includes(host) || referer.includes('localhost')))
  if (!callerOk) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { error } = await supabaseAdmin
      .from('clients')
      .delete()
      .eq('id', params.id)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// PATCH /api/clients/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json()
    const allowed = [
      'name', 'domain', 'semrush_db', 'plan_tier',
      'airtable_base_id', 'airtable_content_table_id', 'airtable_keywords_table_id',
      'airtable_embed_social', 'airtable_embed_keywords', 'airtable_embed_seo',
    ]
    const update: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in body) update[key] = body[key]
    }

    const { data, error } = await supabaseAdmin
      .from('clients')
      .update(update)
      .eq('id', params.id)
      .select(SELECT_FIELDS)
      .single()

    if (error) throw error
    return NextResponse.json({ client: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
