import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAccounts, uploadMediaFromUrl, schedulePost } from '@/lib/publer/client'
import { updateRecord } from '@/lib/airtable/client'

// POST /api/publer/schedule
// 手动从 Visuals 页面触发：用指定 asset + 账号 + 时间 发布到 Publer
export async function POST(req: NextRequest) {
  try {
    const { asset_id, account_id, scheduled_at, caption } = await req.json()

    if (!asset_id || !account_id || !scheduled_at) {
      return NextResponse.json({ error: 'asset_id, account_id, scheduled_at are required' }, { status: 400 })
    }

    const { data: asset } = await supabaseAdmin
      .from('visual_assets')
      .select('id, asset_type, generation_status, storage_url, post_id')
      .eq('id', asset_id)
      .single()

    if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    if (asset.generation_status !== 'ready') {
      return NextResponse.json({ error: 'Asset not ready' }, { status: 400 })
    }
    if (!asset.storage_url) {
      return NextResponse.json({ error: 'Asset has no storage URL' }, { status: 400 })
    }

    const accounts = await getAccounts()
    const account = accounts.find(a => a.id === account_id)
    if (!account) return NextResponse.json({ error: 'Publer account not found' }, { status: 404 })

    let finalCaption = caption ?? ''
    if (!finalCaption && asset.post_id) {
      const { data: post } = await supabaseAdmin
        .from('content_posts')
        .select('caption, hashtags')
        .eq('id', asset.post_id)
        .single()
      const tags = post?.hashtags ? `\n\n${post.hashtags}` : ''
      finalCaption = `${post?.caption ?? ''}${tags}`.trim()
    }

    const fileName = asset.storage_url.split('/').pop() ?? 'media'
    const media = await uploadMediaFromUrl(asset.storage_url, fileName)

    const result = await schedulePost({
      accountId: account_id,
      provider: account.provider,
      assetType: asset.asset_type,
      media,
      caption: finalCaption,
      scheduledAt: new Date(scheduled_at).toISOString(),
    })

    // ── 写回 Airtable Publer_Post_ID ─────────────────────────────────
    if (asset.post_id) {
      try {
        const { data: post } = await supabaseAdmin
          .from('content_posts')
          .select('airtable_record_id, clients(airtable_base_id, airtable_content_table_id)')
          .eq('id', asset.post_id)
          .single()

        const airtableRecordId = post?.airtable_record_id
        const clientsData = post?.clients as { airtable_base_id: string; airtable_content_table_id?: string } | { airtable_base_id: string; airtable_content_table_id?: string }[] | undefined
        const clientObj = Array.isArray(clientsData) ? clientsData[0] : clientsData
        const baseId = clientObj?.airtable_base_id
        const contentTableId = clientObj?.airtable_content_table_id

        if (airtableRecordId && baseId) {
          const tableName = contentTableId ?? 'Content Calendar'
          await updateRecord(baseId, tableName, airtableRecordId, {
            'Publer_Post_ID': result.job_id,
          })
        }
      } catch (atErr) {
        console.error('[publer/schedule] Airtable writeback failed:', atErr)
      }
    }
    // ─────────────────────────────────────────────────────────────────

    return NextResponse.json({ success: true, job_id: result.job_id })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[publer/schedule]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
