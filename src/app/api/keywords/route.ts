import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// GET /api/keywords?client_id=&status=&intent=
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const clientId = searchParams.get('client_id')
    const status = searchParams.get('status')
    const intent = searchParams.get('intent')

    let query = supabaseAdmin
      .from('keywords')
      .select('id, keyword, volume, kd, cpc, intent, opportunity_score, status, source, created_at')
      .order('opportunity_score', { ascending: false })
      .limit(200)

    if (clientId) query = query.eq('client_id', clientId)
    if (status) query = query.eq('status', status)
    if (intent) query = query.eq('intent', intent)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ keywords: data ?? [] })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
