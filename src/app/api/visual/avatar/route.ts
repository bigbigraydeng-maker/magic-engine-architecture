import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { submitAvatarVideo } from '@/lib/visual/heygen'

export async function POST(req: NextRequest) {
  try {
    const { post_id, client_id, avatar_id, voice_id, variant = 1 } = await req.json()

    if (!post_id || !client_id) {
      return NextResponse.json(
        { success: false, error: 'post_id and client_id required' },
        { status: 400 }
      )
    }

    const { data: post } = await supabaseAdmin
      .from('content_posts')
      .select('script')
      .eq('id', post_id)
      .single()

    if (!post?.script) {
      return NextResponse.json(
        { success: false, error: 'No script on this post' },
        { status: 400 }
      )
    }

    const { video_id } = await submitAvatarVideo({
      script: post.script,
      avatar_id,
      voice_id,
    })

    const { data: asset, error } = await supabaseAdmin
      .from('visual_assets')
      .insert({
        post_id,
        client_id,
        asset_type: 'avatar_video',
        provider: 'heygen',
        prompt_used: post.script,
        variant,
        generation_status: 'generating',
        provider_job_id: video_id,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({
      success: true,
      asset_id: asset?.id,
      video_id,
      message: 'Avatar video generation started. Poll /api/visual/status/:assetId.',
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[visual/avatar]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
