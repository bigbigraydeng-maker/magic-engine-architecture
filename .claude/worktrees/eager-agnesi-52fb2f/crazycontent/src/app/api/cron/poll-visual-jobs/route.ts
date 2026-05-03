import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { checkImageStatus } from '@/lib/visual/wavespeed'
import { checkVideoStatus } from '@/lib/visual/seedance'
import { checkAvatarStatus } from '@/lib/visual/heygen'
import { uploadFromUrl } from '@/lib/visual/storage'
import { GENERATION_CONFIG } from '@/lib/visual/generation-config'

type ProviderResult = {
  status: string
  image_url?: string
  video_url?: string
  duration_seconds?: number
  cost_usd?: number
  error?: string
}

/**
 * Schedule next retry with exponential backoff
 * Returns next_retry_at timestamp or null if max retries exceeded
 */
function getNextRetryTime(retryCount: number): Date | null {
  if (retryCount >= GENERATION_CONFIG.MAX_AUTO_RETRIES) {
    return null // Max retries exceeded
  }

  const delayMs = GENERATION_CONFIG.RETRY_DELAYS_MS[retryCount] ?? 900000 // Default 15 minutes
  return new Date(Date.now() + delayMs)
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Process 1: Check generating assets
  const { data: generatingAssets } = await supabaseAdmin
    .from('visual_assets')
    .select('*')
    .eq('generation_status', 'generating')
    .lt('retry_count', GENERATION_CONFIG.MAX_AUTO_RETRIES)

  // Process 2: Check queued_for_retry assets that are ready to retry
  const { data: queuedForRetry } = await supabaseAdmin
    .from('visual_assets')
    .select('*')
    .eq('generation_status', 'queued_for_retry')
    .lte('next_retry_at', new Date().toISOString())

  const allAssets = [...(generatingAssets || []), ...(queuedForRetry || [])]

  if (!allAssets.length) {
    return NextResponse.json({ processed: 0, completed: 0, failed: 0, queued_for_retry: 0, auto_retried: 0 })
  }

  let completed = 0
  let failed = 0
  let queuedForRetryCount = 0
  let autoRetriedCount = 0

  for (const asset of allAssets) {
    try {
      let result: ProviderResult

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

      // ─── Success path ───────────────────────────────────────────────
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
            next_retry_at: null,
          })
          .eq('id', asset.id)

        completed++
      }
      // ─── Failure path with retry ───────────────────────────────────
      else if (result.status === 'failed') {
        const newRetryCount = (asset.retry_count || 0) + 1
        const nextRetryTime = getNextRetryTime(newRetryCount)

        // Max retries exceeded - mark as failed
        if (!nextRetryTime) {
          await supabaseAdmin
            .from('visual_assets')
            .update({
              generation_status: 'failed',
              error_message: result.error,
              last_error_code: 'max_retries_exceeded',
            })
            .eq('id', asset.id)
          failed++
        } else {
          // Schedule auto-retry
          await supabaseAdmin
            .from('visual_assets')
            .update({
              generation_status: 'queued_for_retry',
              error_message: result.error,
              last_error_code: result.error?.toLowerCase().includes('quota')
                ? 'quota_exceeded'
                : result.error?.toLowerCase().includes('timeout')
                  ? 'network_timeout'
                  : 'provider_error',
              retry_count: newRetryCount,
              next_retry_at: nextRetryTime.toISOString(),
            })
            .eq('id', asset.id)

          // Log attempt
          try {
            await supabaseAdmin
              .from('generation_attempts')
              .insert({
                asset_id: asset.id,
                attempt_number: newRetryCount,
                status: 'failed',
                error_code: 'provider_error',
                error_message: result.error,
              })
          } catch (logErr) {
            console.error(`[poll-visual-jobs] Failed to log attempt for ${asset.id}:`, logErr)
          }

          queuedForRetryCount++
          autoRetriedCount++
        }
      }
      // ─── Still processing ───────────────────────────────────────────
      else {
        // Keep asset in generating state, it will be checked again next cycle
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[poll-visual-jobs] Error for asset ${asset.id}:`, err)

      // On provider API errors, schedule retry instead of immediate failure
      const newRetryCount = (asset.retry_count || 0) + 1
      const nextRetryTime = getNextRetryTime(newRetryCount)

      if (nextRetryTime) {
        try {
          await supabaseAdmin
            .from('visual_assets')
            .update({
              generation_status: 'queued_for_retry',
              error_message: `Provider error: ${errMsg}`,
              last_error_code: 'api_error',
              retry_count: newRetryCount,
              next_retry_at: nextRetryTime.toISOString(),
            })
            .eq('id', asset.id)
        } catch (dbErr) {
          console.error(`[poll-visual-jobs] Failed to update asset ${asset.id}:`, dbErr)
        }

        queuedForRetryCount++
        autoRetriedCount++
      } else {
        // Max retries exceeded
        try {
          await supabaseAdmin
            .from('visual_assets')
            .update({
              generation_status: 'failed',
              error_message: `Max retries exceeded. Last error: ${errMsg}`,
              last_error_code: 'max_retries_exceeded',
            })
            .eq('id', asset.id)
        } catch (dbErr) {
          console.error(`[poll-visual-jobs] Failed to mark asset ${asset.id} as failed:`, dbErr)
        }

        failed++
      }
    }
  }

  return NextResponse.json({
    processed: allAssets.length,
    completed,
    failed,
    queued_for_retry: queuedForRetryCount,
    auto_retried: autoRetriedCount,
  })
}
