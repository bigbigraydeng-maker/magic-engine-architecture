import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { updateRecord } from '@/lib/airtable/client'

// Publer 发布成功后回调此 webhook
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { publer_post_id, published_at, post_url } = body

    if (!publer_post_id) {
      return NextResponse.json({ error: 'publer_post_id required' }, { status: 400 })
    }

    const { data: post } = await supabaseAdmin
      .from('content_posts')
      .select('*, clients(airtable_base_id)')
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

    // 同步状态回 Airtable
    const airtableBaseId = (post.clients as { airtable_base_id?: string } | null)?.airtable_base_id
    if (post.airtable_record_id && airtableBaseId) {
      await updateRecord(
        airtableBaseId,
        'Content Calendar',
        post.airtable_record_id,
        {
          'Status': 'Published',
          'Published At': (published_at || new Date().toISOString()).split('T')[0],
          'Published URL': post_url || '',
        }
      )
    }

    return NextResponse.json({ success: true })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[webhook/publer-published]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
