import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createRecord } from '@/lib/airtable/client'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { client_id, asset_ids } = body

    if (!client_id) {
      return NextResponse.json({ success: false, error: 'client_id required' }, { status: 400 })
    }

    // 获取客户的 Airtable base
    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('airtable_base_id')
      .eq('id', client_id)
      .single()

    if (!client?.airtable_base_id) {
      return NextResponse.json(
        { success: false, error: 'No Airtable base configured for this client' },
        { status: 400 }
      )
    }

    // 查询要同步的素材
    let query = supabaseAdmin
      .from('visual_assets')
      .select('id, asset_type, generation_status, storage_url, provider, prompt_used, cost_usd, created_at, post_id')
      .eq('client_id', client_id)
      .eq('generation_status', 'ready')

    if (asset_ids?.length > 0) {
      query = query.in('id', asset_ids)
    } else {
      query = query.order('created_at', { ascending: false }).limit(20)
    }

    const { data: assets, error: assetsError } = await query
    if (assetsError) throw assetsError
    if (!assets?.length) {
      return NextResponse.json({ success: true, synced: 0, message: 'No ready assets to sync' })
    }

    // 批量获取 post 标题
    const postIds = Array.from(new Set(assets.map(a => a.post_id).filter(Boolean)))
    const { data: posts } = await supabaseAdmin
      .from('content_posts')
      .select('id, title')
      .in('id', postIds as string[])

    const postMap = Object.fromEntries((posts ?? []).map(p => [p.id, p.title]))

    // 逐条同步到 Airtable Visual Assets 表
    let synced = 0
    for (const asset of assets) {
      try {
        await createRecord(client.airtable_base_id, 'Visual Assets', {
          'Asset_ID':           asset.id,
          'Asset_Type':         asset.asset_type,
          'Status':             asset.generation_status,
          'Asset_URL':          asset.storage_url ?? '',
          'Content_Post_Title': postMap[asset.post_id ?? ''] ?? '',
          'Provider':           asset.provider ?? '',
          'Prompt':             asset.prompt_used ?? '',
          'Cost_USD':           asset.cost_usd ?? 0,
          'Created_At':         asset.created_at?.split('T')[0] ?? '',
        })
        synced++
      } catch (e) {
        console.error(`[sync-visuals] failed for asset ${asset.id}:`, e)
      }
    }

    return NextResponse.json({ success: true, synced })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[airtable/sync-visuals]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
