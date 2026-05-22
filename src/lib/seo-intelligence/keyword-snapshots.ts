import { supabaseAdmin } from '@/lib/supabase'
import { getRankedKeywords, type LabsKeyword } from '@/lib/dataforseo/labs'

export const LOCATION_CODE_BY_DB: Record<string, number> = { au: 2036, nz: 2554 }
const SNAPSHOT_LIMIT = 200

export interface KeywordSnapshotClient {
  id: string
  domain: string
  semrush_db: string | null
}

export interface KeywordSnapshotRow {
  client_id: string
  domain: string
  keyword: string
  position: number | null
  search_volume: number | null
  keyword_difficulty: number | null
  cpc: number | null
  competition: number | null
  intent: string | null
  source: 'dataforseo'
  location_code: number
  semrush_db: string | null
  snapshot_date: string
  measured_at: string
}

export interface KeywordSnapshotResult {
  client_id: string
  domain: string
  location_code: number
  keywords_seen: number
  snapshots_written: number
}

export function locationCodeForDb(semrushDb: string | null | undefined): number {
  return LOCATION_CODE_BY_DB[semrushDb ?? 'au'] ?? LOCATION_CODE_BY_DB.au
}

export function buildKeywordSnapshotRows(
  client: KeywordSnapshotClient,
  keywords: LabsKeyword[],
  measuredAt = new Date(),
): KeywordSnapshotRow[] {
  const measuredAtIso = measuredAt.toISOString()
  const snapshotDate = measuredAtIso.slice(0, 10)
  const locationCode = locationCodeForDb(client.semrush_db)

  return keywords
    .filter(kw => kw.keyword.trim().length > 0)
    .map(kw => ({
      client_id: client.id,
      domain: client.domain,
      keyword: kw.keyword,
      position: kw.position ?? null,
      search_volume: kw.search_volume,
      keyword_difficulty: kw.keyword_difficulty,
      cpc: kw.cpc,
      competition: kw.competition,
      intent: kw.intent,
      source: 'dataforseo',
      location_code: locationCode,
      semrush_db: client.semrush_db,
      snapshot_date: snapshotDate,
      measured_at: measuredAtIso,
    }))
}

export async function snapshotRankedKeywordsForClient(
  client: KeywordSnapshotClient,
): Promise<KeywordSnapshotResult> {
  const locationCode = locationCodeForDb(client.semrush_db)
  const keywords = await getRankedKeywords(client.domain, locationCode, SNAPSHOT_LIMIT)
  const rows = buildKeywordSnapshotRows(client, keywords)

  if (rows.length === 0) {
    return {
      client_id: client.id,
      domain: client.domain,
      location_code: locationCode,
      keywords_seen: 0,
      snapshots_written: 0,
    }
  }

  const { data, error } = await supabaseAdmin
    .from('keyword_snapshots')
    .upsert(rows, {
      onConflict: 'client_id,keyword,location_code,snapshot_date',
    })
    .select('id')

  if (error) {
    throw new Error(`keyword_snapshots upsert failed: ${error.message}`)
  }

  return {
    client_id: client.id,
    domain: client.domain,
    location_code: locationCode,
    keywords_seen: keywords.length,
    snapshots_written: data?.length ?? rows.length,
  }
}
