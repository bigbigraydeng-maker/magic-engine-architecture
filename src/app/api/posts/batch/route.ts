// Batch update post status (approve / reject multiple posts at once)
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { post_ids, status } = await req.json()

    if (!Array.isArray(post_ids) || post_ids.length === 0) {
      return NextResponse.json({ success: false, error: 'post_ids array required' }, { status: 400 })
    }

    if (!post_ids.every((id: unknown) => typeof id === 'string' && id.length > 0)) {
      return NextResponse.json({ success: false, error: 'post_ids must be an array of non-empty strings' }, { status: 400 })
    }

    if (!['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ success: false, error: 'status must be approved or rejected' }, { status: 400 })
    }

    if (post_ids.length > 100) {
      return NextResponse.json({ success: false, error: 'Max 100 posts per batch' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('content_posts')
      .update({ status })
      .in('id', post_ids)
      .select('id, status')

    if (error) throw error

    return NextResponse.json({
      success: true,
      updated: data?.length ?? 0,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
