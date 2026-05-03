import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { listRecords } from '@/lib/airtable/client'

// GET /api/airtable/pull-keywords?client_id=xxx
// 从 Airtable Keywords 表拉取关键词 → upsert 到 Supabase keywords 表
export async function GET(req: NextRequest) {
  try {
    const client_id = req.nextUrl.searchParams.get('client_id')
    if (!client_id) {
      return NextResponse.json({ success: false, error: 'client_id required' }, { status: 400 })
    }

    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('id, airtable_base_id, airtable_keywords_table_id')
      .eq('id', client_id)
      .single()

    if (!client?.airtable_base_id) {
      return NextResponse.json(
        { success: false, error: 'No Airtable base configured for this client' },
        { status: 400 }
      )
    }

    const tableName = (client.airtable_keywords_table_id as string | null) ?? 'Keywords'

    const records = await listRecords(client.airtable_base_id, tableName, { maxRecords: 500 })

    let created = 0
    let updated = 0
    const errors: string[] = []

    for (const record of records) {
      const f = record.fields as Record<string, unknown>
      const keyword = (f['Keyword'] ?? f['keyword']) as string | undefined
      if (!keyword?.trim()) continue

      const row = mapKeyword(f, client_id, record.id)

      const { data: existing } = await supabaseAdmin
        .from('keywords')
        .select('id')
        .eq('client_id', client_id)
        .eq('airtable_record_id', record.id)
        .maybeSingle()

      if (existing) {
        const { error } = await supabaseAdmin
          .from('keywords')
          .update(row)
          .eq('id', existing.id)
        if (error) errors.push(`Update ${existing.id}: ${error.message}`)
        else updated++
      } else {
        const { error } = await supabaseAdmin
          .from('keywords')
          .insert(row)
        if (error) errors.push(`Create from ${record.id}: ${error.message}`)
        else created++
      }
    }

    return NextResponse.json({
      success: true,
      total: records.length,
      created,
      updated,
      errors: errors.length > 0 ? errors : undefined,
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[airtable/pull-keywords]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// ── 字段映射（兼容常见 Airtable 字段名）─────────────────────────────────────

function mapKeyword(
  f: Record<string, unknown>,
  client_id: string,
  airtable_record_id: string
): Record<string, unknown> {
  const num = (v: unknown) => (v != null && v !== '' ? Number(v) : null)

  const rawStatus = ((f['Status'] as string) ?? '').toLowerCase().trim()
  const validStatuses = ['new', 'approved', 'rejected', 'reviewed', 'published', 'page_created']
  const status = validStatuses.includes(rawStatus) ? rawStatus : 'new'

  const rawIntent = (
    (f['Intent'] ?? f['Search Intent'] ?? f['search_intent']) as string | undefined
  )?.toLowerCase().trim() ?? null

  return {
    client_id,
    airtable_record_id,
    keyword: ((f['Keyword'] ?? f['keyword']) as string).trim(),
    volume: num(f['Volume'] ?? f['Search Volume'] ?? f['Monthly Volume'] ?? f['monthly_volume']),
    kd: num(f['KD'] ?? f['Keyword Difficulty'] ?? f['Difficulty']),
    cpc: num(f['CPC'] ?? f['cpc']),
    intent: rawIntent,
    status,
    source: 'airtable',
  }
}
