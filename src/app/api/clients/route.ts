import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// GET /api/clients — list all clients
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('id, name, domain, airtable_base_id, created_at, semrush_db, plan_tier')
      .order('created_at', { ascending: false })

    if (error) throw error
    return NextResponse.json({ clients: data ?? [] })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// POST /api/clients — create new client
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, domain, website_url, airtable_base_id } = body

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('clients')
      .insert({
        name,
        domain: domain || website_url || null,   // accept both field names
        airtable_base_id: airtable_base_id || null,
        semrush_db: 'au',
        monthly_quota: 1000,
        plan_tier: 'starter',
      })
      .select('id, name')
      .single()

    if (error) throw error
    return NextResponse.json({ client: data }, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
