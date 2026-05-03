import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createRecords } from '@/lib/airtable/client'
import { KEYWORD_TO_AIRTABLE } from '@/lib/airtable/field-maps'

export async function POST(req: NextRequest) {
  try {
    const { client_id } = await req.json()
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

    // 找未同步的新关键词，按 opportunity_score 降序
    const { data: keywords } = await supabaseAdmin
      .from('keywords')
      .select('*')
      .eq('client_id', client_id)
      .eq('status', 'new')
      .is('airtable_record_id', null)
      .order('opportunity_score', { ascending: false })
      .limit(50)

    if (!keywords?.length) {
      return NextResponse.json({ success: true, synced: 0, message: 'No new keywords to sync' })
    }

    const airtableRecords = await createRecords(
      client.airtable_base_id,
      'Keywords',
      keywords.map(KEYWORD_TO_AIRTABLE)
    )

    // 回填 airtable_record_id
    await Promise.all(
      airtableRecords.map((ar, idx) =>
        supabaseAdmin
          .from('keywords')
          .update({ airtable_record_id: ar.id })
          .eq('id', keywords[idx].id)
      )
    )

    return NextResponse.json({ success: true, synced: airtableRecords.length })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[airtable/sync-keywords]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
