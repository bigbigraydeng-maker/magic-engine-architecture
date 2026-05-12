import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { publer_post_id, published_at } = body

    if (!publer_post_id) {
      return NextResponse.json({ error: 'publer_post_id required' }, { status: 400 })
    }

    const { data: post } = await supabaseAdmin
      .from('content_posts')
      .select('id')
      .eq('publer_post_id', publer_post_id)
      .single()

    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    await supabaseAdmin
      .from('content_posts')
      .update({
        status: 'published',
        published_at: published_at || new Date().toISOString(),
      })
      .eq('id', post.id)

    return NextResponse.json({ success: true })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[webhook/publer-published]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
