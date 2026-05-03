/**
 * GET /api/clients/[id]/reels/[draftId]/video-status
 *
 * Poll the Atlas job status for a Reels video generation.
 * When completed, saves the video_url to the draft and sets status → 'video_ready'.
 *
 * Reference: ROADMAP.md P8.R.5
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { checkVideoStatus } from '@/lib/visual/seedance'
import { uploadFromUrl } from '@/lib/visual/storage'

type RouteContext = { params: { id: string; draftId: string } }

export async function GET(
  _req: NextRequest,
  { params }: RouteContext
) {
  const { id: clientId, draftId } = params

  try {
    const { data: draft, error: fetchErr } = await supabaseAdmin
      .from('reels_drafts')
      .select('status, provider_job_id, video_url')
      .eq('id', draftId)
      .eq('client_id', clientId)
      .single()

    if (fetchErr || !draft) {
      return NextResponse.json({ success: false, error: 'Draft not found' }, { status: 404 })
    }

    // Already done — return cached result
    if (draft.status === 'video_ready' && draft.video_url) {
      return NextResponse.json({
        success: true,
        status: 'completed',
        video_url: draft.video_url,
      })
    }

    if (!draft.provider_job_id) {
      return NextResponse.json(
        { success: false, error: 'No video job in progress for this draft.' },
        { status: 400 }
      )
    }

    // Poll Atlas
    const result = await checkVideoStatus(draft.provider_job_id)

    if (result.status === 'completed' && result.video_url) {
      // Upload to Supabase Storage for a permanent URL (Atlas CDN URLs expire in 24 h)
      const { storage_url } = await uploadFromUrl({
        sourceUrl: result.video_url,
        clientId,
        folder: `reels/${draftId}`,
        assetType: 'video',
      })

      await supabaseAdmin
        .from('reels_drafts')
        .update({ status: 'video_ready', video_url: storage_url })
        .eq('id', draftId)

      return NextResponse.json({
        success: true,
        status: 'completed',
        video_url: storage_url,
        error: null,
      })
    }

    return NextResponse.json({
      success: true,
      status: result.status,
      video_url: null,
      error: result.error ?? null,
    })

  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : JSON.stringify(err)
    console.error('[reels/video-status] error:', JSON.stringify(err))
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
