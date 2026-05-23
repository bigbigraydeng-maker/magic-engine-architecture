import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireSession } from '@/lib/auth/require-session'
import { getRankedKeywords } from '@/lib/dataforseo/labs'
import { getLatestKeywordSnapshotForClient } from '@/lib/seo-intelligence/keyword-snapshots'

const LOCATION_CODE_BY_DB: Record<string, number> = { au: 2036, nz: 2554 }

/**
 * GET /api/clients/[id]/seo-intelligence/rankings
 *
 * Returns up to 200 organic-ranked keywords for the client's domain,
 * ordered by position ascending (rank 1 first).
 *
 * Response shape:
 * {
 *   domain:   string
 *   keywords: Array<LabsKeyword & { position: number | null }>
 * }
 *
 * Cache: 24 h (DataForSEO live call, expensive).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession()
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status })
  }

  const { id: clientId } = await params

  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('id, domain, semrush_db')
    .eq('id', clientId)
    .single()

  if (clientError || !client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  if (!client.domain) {
    return NextResponse.json(
      { error: 'Client has no domain configured' },
      { status: 400 },
    )
  }

  const locationCode = LOCATION_CODE_BY_DB[client.semrush_db ?? 'au'] ?? LOCATION_CODE_BY_DB.au

  try {
    const keywords = await getRankedKeywords(client.domain, locationCode, 200)

    return NextResponse.json(
      { domain: client.domain, keywords },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
        },
      },
    )
  } catch (err) {
    try {
      const snapshot = await getLatestKeywordSnapshotForClient({
        id: client.id,
        domain: client.domain,
        semrush_db: client.semrush_db,
      })
      return NextResponse.json(
        {
          domain: client.domain,
          keywords: snapshot.keywords,
          source: 'snapshot',
          snapshot_date: snapshot.snapshot_date,
          warning: snapshot.snapshot_date
            ? 'Live Keyword Intelligence is temporarily unavailable. Showing the latest saved weekly snapshot.'
            : 'Live Keyword Intelligence is temporarily unavailable and no saved weekly snapshot exists yet.',
        },
        {
          headers: {
            'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=300',
          },
        },
      )
    } catch {
      return NextResponse.json(
        { error: 'Keyword Intelligence is temporarily unavailable. Try again after the next saved snapshot.' },
        { status: 502 },
      )
    }
  }
}
