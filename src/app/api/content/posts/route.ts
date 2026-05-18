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
      .select('id, client_id, title, route, platforms, status, caption, script, hashtags, visual_brief, scheduled_at, created_at, execution_item_id, clients(name)')
      .order('created_at', { ascending: false })
      .limit(100)

    if (clientId) query = query.eq('client_id', clientId)
    if (status) {
      // Support comma-separated multi-status: "approved,scheduled"
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean)
      if (statuses.length === 1) {
        query = query.eq('status', statuses[0])
      } else if (statuses.length > 1) {
        query = query.in('status', statuses)
      }
    }

    const { data, error } = await query
    if (error) throw error

    const posts = (data ?? []) as Array<{
      id: string
      [k: string]: unknown
    }>

    // 附带每篇 post 的视觉资产（final 优先，否则最新 ready）
    let assetByPost: Record<string, { url: string; type: string }> = {}
    if (posts.length > 0) {
      const { data: assetRows } = await supabaseAdmin
        .from('visual_assets')
        .select('post_id, storage_url, asset_type, is_final, generation_status, created_at')
        .in('post_id', posts.map(p => p.id))
        .eq('generation_status', 'ready')
        .not('storage_url', 'is', null)
        .order('is_final', { ascending: false })
        .order('created_at', { ascending: false })

      for (const row of (assetRows ?? []) as Array<{
        post_id: string; storage_url: string; asset_type: string; is_final: boolean
      }>) {
        if (!assetByPost[row.post_id]) {
          assetByPost[row.post_id] = { url: row.storage_url, type: row.asset_type }
        }
      }
    }

    const enriched = posts.map(p => ({
      ...p,
      visual_asset_url: assetByPost[p.id]?.url ?? null,
      visual_asset_type: assetByPost[p.id]?.type ?? null,
    }))

    return NextResponse.json({ posts: enriched })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
