import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { checkImageStatus } from '@/lib/visual/wavespeed'
import { checkVideoStatus } from '@/lib/visual/seedance'
import { checkAvatarStatus } from '@/lib/visual/heygen'
import { uploadFromUrl } from '@/lib/visual/storage'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: pendingAssets } = await supabaseAdmin
    .from('visual_assets')
    .select('*')
    .eq('generation_status', 'generating')
    .lt('retry_count', 10)

  if (!pendingAssets?.length) {
    return NextResponse.json({ processed: 0 })
  }

  let completed = 0, failed = 0, stillPending = 0

  for (const asset of pendingAssets) {
    try {
      type Result = { status: string; image_url?: string; video_url?: string; duration_seconds?: number; cost_usd?: number; error?: string }
      let result: Result

      if (asset.provider === 'wavespeed') {
        result = await checkImageStatus(asset.provider_job_id)
      } else if (asset.provider === 'seedance') {
        result = await checkVideoStatus(asset.provider_job_id)
      } else if (asset.provider === 'heygen') {
        result = await checkAvatarStatus(asset.provider_job_id)
      } else {
        continue
      }

      const completedUrl = result.image_url || result.video_url

      if (result.status === 'completed' && completedUrl) {
        const { storage_url, file_size_kb } = await uploadFromUrl({
          sourceUrl: completedUrl,
          clientId: asset.client_id,
          postId: asset.post_id,
          assetType: asset.asset_type,
          variant: asset.variant,
        })

        await supabaseAdmin
          .from('visual_assets')
          .update({
            generation_status: 'ready',
            storage_url,
            provider_url: completedUrl,
            file_size_kb,
            duration_seconds: result.duration_seconds,
            cost_usd: result.cost_usd,
          })
          .eq('id', asset.id)

        completed++

      } else if (result.status === 'failed') {
        await supabaseAdmin
          .from('visual_assets')
          .update({ generation_status: 'failed', error_message: result.error })
          .eq('id', asset.id)
        failed++

      } else {
        await supabaseAdmin
          .from('visual_assets')
          .update({ retry_count: asset.retry_count + 1 })
          .eq('id', asset.id)
        stillPending++
      }

    } catch (err: unknown) {
      console.error(`[poll-visual-jobs] Error for asset ${asset.id}:`, err)
    }
  }

  return NextResponse.json({ processed: pendingAssets.length, completed, failed, stillPending })
}
