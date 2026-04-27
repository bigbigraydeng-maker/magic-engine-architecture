import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createPublerPost } from '@/lib/publer/client'

export async function POST(req: NextRequest) {
  try {
    const { post_id, client_id, schedule_at } = await req.json()
    if (!post_id || !client_id) {
      return NextResponse.json({ success: false, error: 'post_id and client_id required' }, { status: 400 })
    }

    const { data: post } = await supabaseAdmin
      .from('content_posts')
      .select('*')
      .eq('id', post_id)
      .single()

    if (!post) {
      return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 })
    }
    if (post.status !== 'approved') {
      return NextResponse.json({ success: false, error: 'Post not approved' }, { status: 400 })
    }

    // 取最新 ready 素材（is_selected 优先）
    const { data: assets } = await supabaseAdmin
      .from('visual_assets')
      .select('storage_url, asset_type')
      .eq('post_id', post_id)
      .eq('generation_status', 'ready')
      .order('is_selected', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)

    const mediaUrl = assets?.[0]?.storage_url

    const result = await createPublerPost({
      caption: post.caption || post.script || '',
      media_urls: mediaUrl ? [mediaUrl] : [],
      platforms: post.platforms || ['facebook'],
      schedule_at,
      hashtags: post.hashtags,
    })

    await supabaseAdmin
      .from('content_posts')
      .update({
        status: 'scheduled',
        publer_post_id: result.post_id,
        scheduled_at: schedule_at || new Date().toISOString(),
      })
      .eq('id', post_id)

    return NextResponse.json({ success: true, publer_post: result })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[publer/create-post]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
