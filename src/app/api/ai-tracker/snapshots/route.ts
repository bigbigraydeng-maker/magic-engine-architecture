import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET /api/ai-tracker/snapshots?client_id=...&limit=4
 *
 * Returns weekly AI Visibility snapshots for a client, ordered by week_of DESC.
 * Used by the frontend Rankings Table tab.
 *
 * Reference: ROADMAP.md P7.1.12
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const clientId = url.searchParams.get('client_id')
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '4', 10), 12)

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: 'client_id is required' },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('ai_visibility_snapshots')
      .select('*')
      .eq('client_id', clientId)
      .order('week_of', { ascending: false })
      .limit(limit)

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      snapshots: data ?? [],
      count: data?.length ?? 0,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
