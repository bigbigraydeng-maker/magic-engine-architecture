import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { checkImageStatus } from '@/lib/visual/wavespeed'
import { checkVideoStatus } from '@/lib/visual/seedance'
import { checkAvatarStatus } from '@/lib/visual/heygen'
import { uploadFromUrl } from '@/lib/visual/storage'
import { updateRecord } from '@/lib/airtable/client'

type ProviderResult = {
  status: string
  image_url?: string
  video_url?: string
  duration_seconds?: number
  cost_usd?: number
  error?: string
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { assetId: string } }
) {
  try {
    const { data: asset } = await supabaseAdmin
      .from('visual_assets')
      .select('*')
      .eq('id', params.assetId)
      .single()

    if (!asset) {
      return NextResponse.json({ success: false, error: 'Asset not found' }, { status: 404 })
    }

    if (asset.generation_status === 'ready' || asset.generation_status === 'failed') {
      return NextResponse.json({ success: true, asset })
    }

    let providerResult: ProviderResult
    if (asset.provider === 'wavespeed') {
      providerResult = await checkImageStatus(asset.provider_job_id)
    } else if (asset.provider === 'seedance') {
      const r = await checkVideoStatus(asset.provider_job_id)
      providerResult = { ...r, image_url: undefined }
    } else if (asset.provider === 'heygen') {
      const r = await checkAvatarStatus(asset.provider_job_id)
      providerResult = { ...r, image_url: undefined }
    } else {
      return NextResponse.json({ success: true, asset })
    }

    const completedUrl = providerResult.image_url || providerResult.video_url

    if (providerResult.status === 'completed' && completedUrl) {
      const { storage_url, file_size_kb } = await uploadFromUrl({
        sourceUrl: completedUrl,
        clientId: asset.client_id,
        postId: asset.post_id,
        assetType: asset.asset_type,
        variant: asset.variant,
      })

      const { data: updated, error } = await supabaseAdmin
        .from('visual_assets')
        .update({
          generation_status: 'ready',
          storage_url,
          provider_url: completedUrl,
          file_size_kb,
          duration_seconds: providerResult.duration_seconds,
          cost_usd: providerResult.cost_usd,
        })
        .eq('id', params.assetId)
        .select()
        .single()

      if (error) throw error

      // ── 回写 Airtable Content Calendar ──────────────────────────────
      if (updated && asset.post_id) {
        try {
          const { data: post } = await supabaseAdmin
            .from('content_posts')
            .select('airtable_record_id, clients(airtable_base_id)')
            .eq('id', asset.post_id)
            .single()

          const airtableRecordId = post?.airtable_record_id
          const baseId = (post?.clients as Record<string, string> | null)?.airtable_base_id

          if (airtableRecordId && baseId) {
            const fields: Record<string, unknown> = { 'Visual_Status': 'Ready' }
            if (asset.asset_type === 'image') fields['Image_URL'] = storage_url
            else if (asset.asset_type === 'video' || asset.asset_type === 'avatar') fields['Video_URL'] = storage_url

            await updateRecord(baseId, 'Content Calendar', airtableRecordId, fields)
          }
        } catch (atErr) {
          // 非致命错误 — 记录日志但不阻断主响应
          console.error('[visual/status] Airtable writeback failed:', atErr)
        }
      }
      // ─────────────────────────────────────────────────────────────────

      return NextResponse.json({ success: true, asset: updated, just_completed: true })
    }

    if (providerResult.status === 'failed') {
      await supabaseAdmin
        .from('visual_assets')
        .update({ generation_status: 'failed', error_message: providerResult.error })
        .eq('id', params.assetId)
    }

    return NextResponse.json({
      success: true,
      asset: { ...asset, generation_status: providerResult.status },
      still_processing: providerResult.status === 'processing' || providerResult.status === 'pending',
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[visual/status]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
