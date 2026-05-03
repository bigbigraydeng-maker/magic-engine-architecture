/**
 * POST /api/clients/[id]/reels/[draftId]/generate-video
 *
 * Triggers Atlas Seedance 2.0 Image-to-Video generation.
 * Requires both opening_frame_url and closing_frame_url to be set.
 * Stores the Atlas job_id in the draft row and sets status → 'video_generating'.
 *
 * Reference: ROADMAP.md P8.R.5
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { submitI2VGeneration } from '@/lib/visual/seedance'

type RouteContext = { params: { id: string; draftId: string } }

export async function POST(
  _req: NextRequest,
  { params }: RouteContext
) {
  const { id: clientId, draftId } = params

  try {
    // 1. Load draft
    const { data: draft, error: fetchErr } = await supabaseAdmin
      .from('reels_drafts')
      .select('*')
      .eq('id', draftId)
      .eq('client_id', clientId)
      .single()

    if (fetchErr || !draft) {
      return NextResponse.json({ success: false, error: 'Draft not found' }, { status: 404 })
    }

    if (!draft.opening_frame_url || !draft.closing_frame_url) {
      return NextResponse.json(
        {
          success: false,
          error: 'Both reference frames must be uploaded before generating video.',
        },
        { status: 400 }
      )
    }

    if (!draft.i2v_video_prompt) {
      return NextResponse.json(
        { success: false, error: 'Video prompt is required. Generate or write the prompt first.' },
        { status: 400 }
      )
    }

    if (draft.status === 'video_generating') {
      return NextResponse.json(
        { success: false, error: 'Video generation already in progress.' },
        { status: 409 }
      )
    }

    // 2. Submit I2V job to Atlas
    const { job_id } = await submitI2VGeneration({
      prompt: draft.i2v_video_prompt,
      opening_frame_url: draft.opening_frame_url,
      closing_frame_url: draft.closing_frame_url,
      duration: 6,
      aspect_ratio: '9:16',
    })

    // 3. Update draft status
    const { error: updateErr } = await supabaseAdmin
      .from('reels_drafts')
      .update({
        status: 'video_generating',
        provider_job_id: job_id,
      })
      .eq('id', draftId)

    if (updateErr) throw updateErr

    return NextResponse.json({
      success: true,
      job_id,
      message: 'Video Studio is generating your Reel. Poll /video-status to check progress.',
    })

  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : JSON.stringify(err)
    console.error('[reels/generate-video] error:', JSON.stringify(err))
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
