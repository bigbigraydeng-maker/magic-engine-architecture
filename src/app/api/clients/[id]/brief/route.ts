import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// GET /api/clients/[id]/brief
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data, error } = await supabaseAdmin
      .from('master_briefs')
      .select('*')
      .eq('client_id', params.id)
      .eq('is_active', true)
      .order('version', { ascending: false })
      .limit(1)
      .single()

    if (error && error.code !== 'PGRST116') throw error

    return NextResponse.json({ brief: data ?? null })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// PUT /api/clients/[id]/brief
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json()
    const {
      brand_name,
      tone,
      primary_audience,
      visual_style,
      content_topics,
      products,
    } = body

    // Deactivate old briefs
    await supabaseAdmin
      .from('master_briefs')
      .update({ is_active: false })
      .eq('client_id', params.id)

    // Get next version
    const { data: existing } = await supabaseAdmin
      .from('master_briefs')
      .select('version')
      .eq('client_id', params.id)
      .order('version', { ascending: false })
      .limit(1)
      .single()

    const nextVersion = (existing?.version ?? 0) + 1

    const { data, error } = await supabaseAdmin
      .from('master_briefs')
      .insert({
        client_id: params.id,
        version: nextVersion,
        is_active: true,
        brand_name: brand_name || 'Unnamed Brand',
        tone: tone || null,
        primary_audience: primary_audience || null,
        visual_style: visual_style || null,
        content_topics: content_topics || null,
        products: products || null,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ brief: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
