import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// GET /api/content/posts?client_id=&status=
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const clientId = searchParams.get('client_id')
    const status = searchParams.get('status')

    let query = supabaseAdmin
      .from('content_posts')
      .select('id, title, route, platforms, status, caption, script, hashtags, visual_brief, created_at, clients(name)')
      .order('created_at', { ascending: false })
      .limit(100)

    if (clientId) query = query.eq('client_id', clientId)
    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ posts: data ?? [] })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
