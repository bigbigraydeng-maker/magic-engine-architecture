import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { updateRecord } from '@/lib/airtable/client'

// PATCH /api/posts/[id]
// Updates content_posts in Supabase and writes back to Airtable
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json()

    const allowed = ['title', 'caption', 'visual_brief', 'hashtags', 'scheduled_at', 'status']
    const supabaseUpdate: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in body) supabaseUpdate[key] = body[key]
    }

    const { data: post, error } = await supabaseAdmin
      .from('content_posts')
      .update(supabaseUpdate)
      .eq('id', params.id)
      .select('airtable_record_id, clients(airtable_base_id, airtable_content_table_id)')
      .single()

    if (error) throw error

    // Airtable write-back
    const clientsData = post?.clients as
      | { airtable_base_id: string; airtable_content_table_id?: string }
      | { airtable_base_id: string; airtable_content_table_id?: string }[]
      | undefined
    const clientObj = Array.isArray(clientsData) ? clientsData[0] : clientsData
    const baseId = clientObj?.airtable_base_id
    const contentTableId = clientObj?.airtable_content_table_id
    const airtableRecordId = post?.airtable_record_id

    if (airtableRecordId && baseId) {
      const atFields: Record<string, unknown> = {}
      if ('title' in body) atFields['Headline_EN'] = body.title
      if ('caption' in body) atFields['Caption_EN'] = body.caption
      if ('visual_brief' in body) atFields['LoveArt_Prompt_EN'] = body.visual_brief
      if ('hashtags' in body) {
        atFields['Hashtags_IG'] = Array.isArray(body.hashtags)
          ? body.hashtags.join(' ')
          : (body.hashtags ?? '')
      }
      if ('scheduled_at' in body && body.scheduled_at) {
        // Convert UTC → NZ local (UTC+12 standard)
        const nz = new Date(new Date(body.scheduled_at).getTime() + 12 * 3600 * 1000)
        atFields['Date'] = nz.toISOString().slice(0, 10)
        atFields['Time_NZST'] = nz.toISOString().slice(11, 16)
      }

      if (Object.keys(atFields).length > 0) {
        const tableName = contentTableId ?? 'Content Calendar'
        await updateRecord(baseId, tableName, airtableRecordId, atFields).catch(e =>
          console.error('[posts/patch] Airtable writeback failed:', e)
        )
      }
    }

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
