import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createRecords } from '@/lib/airtable/client'
import { POST_TO_AIRTABLE } from '@/lib/airtable/field-maps'
import type { ContentPost } from '@/types/magic-engine'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { client_id, post_ids } = body

    if (!client_id) {
      return NextResponse.json({ success: false, error: 'client_id required' }, { status: 400 })
    }

    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('airtable_base_id')
      .eq('id', client_id)
      .single()

    if (!client?.airtable_base_id) {
      return NextResponse.json(
        { success: false, error: 'No Airtable base configured for this client' },
        { status: 400 }
      )
    }

    // Build query — use post_ids for targeted sync or find all unsynced drafts
    let query = supabaseAdmin
      .from('content_posts')
      .select('*')
      .eq('client_id', client_id)

    if (post_ids?.length > 0) {
      query = query.in('id', post_ids)
    } else {
      query = query
        .eq('status', 'draft')
        .is('airtable_record_id', null)
        .order('created_at', { ascending: false })
        .limit(20)
    }

    const { data: posts } = await query

    if (!posts?.length) {
      return NextResponse.json({ success: true, synced: 0, message: 'No posts to sync' })
    }

    const airtableRecords = await createRecords(
      client.airtable_base_id,
      'Content Calendar',
      posts.map((p) => POST_TO_AIRTABLE(p as ContentPost))
    )

    // Backfill airtable_record_id
    await Promise.all(
      airtableRecords.map((ar, idx) =>
        supabaseAdmin
          .from('content_posts')
          .update({ airtable_record_id: ar.id })
          .eq('id', posts[idx].id)
      )
    )

    return NextResponse.json({ success: true, synced: airtableRecords.length })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[airtable/sync-content]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
