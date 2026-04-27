import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { submitImageGeneration } from '@/lib/visual/wavespeed'

export async function POST(req: NextRequest) {
  try {
    const { post_id, client_id, variant = 1 } = await req.json()

    if (!post_id || !client_id) {
      return NextResponse.json(
        { success: false, error: 'post_id and client_id required' },
        { status: 400 }
      )
    }

    const { data: post } = await supabaseAdmin
      .from('content_posts')
      .select('visual_brief, revision_notes')
      .eq('id', post_id)
      .single()

    if (!post?.visual_brief) {
      return NextResponse.json(
        { success: false, error: 'No visual_brief on this post' },
        { status: 400 }
      )
    }

    const prompt = post.revision_notes
      ? `${post.visual_brief}. Additional requirements: ${post.revision_notes}`
      : post.visual_brief

    const { job_id } = await submitImageGeneration({ prompt })

    const { data: asset, error } = await supabaseAdmin
      .from('visual_assets')
      .insert({
        post_id,
        client_id,
        asset_type: 'image',
        provider: 'wavespeed',
        prompt_used: prompt,
        variant,
        generation_status: 'generating',
        provider_job_id: job_id,
      })
      .select()
      .single()

    if (error) throw error

    if (post.revision_notes) {
      await supabaseAdmin
        .from('content_posts')
        .update({ revision_notes: null })
        .eq('id', post_id)
    }

    return NextResponse.json({
      success: true,
      asset_id: asset?.id,
      job_id,
      message: 'Image generation started. Poll /api/visual/status/:assetId for updates.',
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[visual/image]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
