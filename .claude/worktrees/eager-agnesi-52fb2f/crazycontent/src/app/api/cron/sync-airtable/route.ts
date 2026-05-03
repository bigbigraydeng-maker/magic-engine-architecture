import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// 每小时把新数据推到各客户的 Airtable
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL not set' }, { status: 500 })
  }

  const { data: clients } = await supabaseAdmin
    .from('clients')
    .select('id, name')
    .not('airtable_base_id', 'is', null)

  const results = []

  for (const client of clients || []) {
    try {
      const [kwRes, postRes] = await Promise.all([
        fetch(`${appUrl}/api/airtable/sync-keywords`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id }),
        }),
        fetch(`${appUrl}/api/airtable/sync-content`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id }),
        }),
      ])

      const [kw, post] = await Promise.all([kwRes.json(), postRes.json()])
      results.push({
        client: client.name,
        keywords_synced: kw.synced ?? 0,
        posts_synced: post.synced ?? 0,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      results.push({ client: client.name, error: message })
    }
  }

  return NextResponse.json({ success: true, results })
}
