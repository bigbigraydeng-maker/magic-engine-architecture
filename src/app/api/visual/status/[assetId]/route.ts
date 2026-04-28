import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { checkImageStatus } from '@/lib/visual/wavespeed'
import { checkVideoStatus } from '@/lib/visual/seedance'
import { checkAvatarStatus } from '@/lib/visual/heygen'
import { uploadFromUrl } from '@/lib/visual/storage'
import { updateRecord } from '@/lib/airtable/client'
import { GenerationErrorResponse } from '@/lib/visual/generation-config'

type ProviderResult = {
  status: string
  image_url?: string
  video_url?: string
  duration_seconds?: number
  cost_usd?: number
  error?: string
}

/**
 * Maps provider errors to structured error responses
 */
function mapErrorToStructured(
  error: string,
  ageMinutes: number
): GenerationErrorResponse {
  const errorLower = error.toLowerCase()

  if (errorLower.includes('quota') || errorLower.includes('rate limit')) {
    return {
      code: 'quota_exceeded',
      message: 'API quota exceeded. Please try again in a few minutes.',
      retryEligible: true,
      suggestedAction: 'Wait 5-15 minutes before retrying',
    }
  }

  if (errorLower.includes('auth') || errorLower.includes('unauthorized')) {
    return {
      code: 'auth_failed',
      message: 'Authentication failed with provider. Contact support.',
      retryEligible: false,
    }
  }

  if (errorLower.includes('timeout') || errorLower.includes('connection')) {
    return {
      code: 'network_error',
      message: 'Network timeout connecting to provider.',
      retryEligible: true,
      suggestedAction: 'Retry will be attempted automatically',
    }
  }

  if (errorLower.includes('invalid') || errorLower.includes('malformed')) {
    return {
      code: 'invalid_input',
      message: 'Invalid input parameters. Please check your prompt.',
      retryEligible: false,
    }
  }

  if (ageMinutes > 60) {
    return {
      code: 'timeout',
      message: `Generation exceeded timeout limit (${Math.floor(ageMinutes)} minutes). The provider may have encountered an issue.`,
      retryEligible: true,
      suggestedAction: 'Manually retry if needed',
    }
  }

  return {
    code: 'provider_error',
    message: `Provider error: ${error}`,
    retryEligible: true,
  }
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
    try {
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
    } catch (providerErr: unknown) {
      const ageMinutes = (Date.now() - new Date(asset.created_at).getTime()) / 60000
      const errMsg = providerErr instanceof Error ? providerErr.message : String(providerErr)

      // Auto-fail after 12 hours
      if (ageMinutes > 720) {
        const errorResponse = mapErrorToStructured(errMsg, ageMinutes)
        const failMessage = `${errorResponse.message} (Age: ${Math.floor(ageMinutes)} minutes)`

        await supabaseAdmin
          .from('visual_assets')
          .update({
            generation_status: 'failed',
            error_message: failMessage,
          })
          .eq('id', params.assetId)

        return NextResponse.json({
          success: true,
          asset: { ...asset, generation_status: 'failed', error_message: failMessage },
          detailed_error: errorResponse,
          auto_failed: true,
        })
      }

      // For transient errors, throw to retry
      throw providerErr
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

      // ── 回写 Airtable ─────────────────────────────────────────────────
      if (updated && asset.post_id) {
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
            // 新社媒总表：写 Image_URL / Video_URL 字段
            if (contentTableId) {
              const fields: Record<string, unknown> = {}
              if (asset.asset_type === 'image') fields['Image_URL'] = storage_url
              else fields['Image_URL'] = storage_url  // 视频也先写 Image_URL 占位
              await updateRecord(baseId, contentTableId, airtableRecordId, fields)
            } else {
              // 兼容旧 Content Calendar 表
              const fields: Record<string, unknown> = { 'Visual_Status': 'Ready' }
              if (asset.asset_type === 'image') fields['Image_URL'] = storage_url
              else if (asset.asset_type === 'video' || asset.asset_type === 'avatar') fields['Video_URL'] = storage_url
              await updateRecord(baseId, 'Content Calendar', airtableRecordId, fields)
            }
          }
        } catch (atErr) {
          console.error('[visual/status] Airtable writeback failed:', atErr)
        }
      }
      // ─────────────────────────────────────────────────────────────────

      return NextResponse.json({ success: true, asset: updated, just_completed: true })
    }

    if (providerResult.status === 'failed') {
      const ageMinutes = (Date.now() - new Date(asset.created_at).getTime()) / 60000
      const errorResponse = mapErrorToStructured(providerResult.error || 'Unknown error', ageMinutes)

      await supabaseAdmin
        .from('visual_assets')
        .update({
          generation_status: 'failed',
          error_message: providerResult.error,
        })
        .eq('id', params.assetId)

      return NextResponse.json({
        success: true,
        asset: { ...asset, generation_status: 'failed', error_message: providerResult.error },
        detailed_error: errorResponse,
      })
    }

    return NextResponse.json({
      success: true,
      asset: {
        ...asset,
        generation_status: providerResult.status,
        cost_usd: providerResult.cost_usd,
        duration_seconds: providerResult.duration_seconds,
      },
      still_processing: providerResult.status === 'processing' || providerResult.status === 'pending',
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[visual/status]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
