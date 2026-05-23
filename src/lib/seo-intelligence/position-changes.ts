import { supabaseAdmin } from '@/lib/supabase'

export type PositionChangeType = 'new' | 'lost' | 'improved' | 'declined'

export interface KeywordSnapshotForChange {
  keyword: string
  position: number | null
  search_volume: number | null
  keyword_difficulty: number | null
  intent: string | null
  snapshot_date: string
}

export interface PositionChange {
  keyword: string
  change_type: PositionChangeType
  previous_position: number | null
  current_position: number | null
  position_delta: number | null
  search_volume: number | null
  keyword_difficulty: number | null
  intent: string | null
}

export interface PositionChangesResult {
  current_date: string | null
  previous_date: string | null
  summary: Record<PositionChangeType, number>
  changes: PositionChange[]
}

const EMPTY_SUMMARY: Record<PositionChangeType, number> = {
  new: 0,
  lost: 0,
  improved: 0,
  declined: 0,
}

export function calculatePositionChanges(
  currentRows: KeywordSnapshotForChange[],
  previousRows: KeywordSnapshotForChange[],
): PositionChangesResult {
  const currentDate = currentRows[0]?.snapshot_date ?? null
  const previousDate = previousRows[0]?.snapshot_date ?? null
  const currentByKeyword = new Map(currentRows.map(row => [row.keyword, row]))
  const previousByKeyword = new Map(previousRows.map(row => [row.keyword, row]))
  const allKeywords = new Set([
    ...Array.from(currentByKeyword.keys()),
    ...Array.from(previousByKeyword.keys()),
  ])
  const changes: PositionChange[] = []

  for (const keyword of Array.from(allKeywords)) {
    const current = currentByKeyword.get(keyword)
    const previous = previousByKeyword.get(keyword)
    const currentPosition = current?.position ?? null
    const previousPosition = previous?.position ?? null
    const base = current ?? previous
    if (!base) continue

    if (!previous && current) {
      changes.push(buildChange(base, 'new', null, currentPosition))
      continue
    }

    if (previous && !current) {
      changes.push(buildChange(base, 'lost', previousPosition, null))
      continue
    }

    if (previousPosition === null || currentPosition === null || previousPosition === currentPosition) {
      continue
    }

    changes.push(buildChange(
      base,
      currentPosition < previousPosition ? 'improved' : 'declined',
      previousPosition,
      currentPosition,
    ))
  }

  const summary = changes.reduce<Record<PositionChangeType, number>>(
    (acc, change) => {
      acc[change.change_type] += 1
      return acc
    },
    { ...EMPTY_SUMMARY },
  )

  return {
    current_date: currentDate,
    previous_date: previousDate,
    summary,
    changes: sortChanges(changes),
  }
}

export async function getPositionChangesForClient(clientId: string): Promise<PositionChangesResult> {
  const dates = await fetchLatestSnapshotDates(clientId)
  if (dates.length < 2) {
    return {
      current_date: dates[0] ?? null,
      previous_date: null,
      summary: { ...EMPTY_SUMMARY },
      changes: [],
    }
  }

  const [currentDate, previousDate] = dates
  const { data, error } = await supabaseAdmin
    .from('keyword_snapshots')
    .select('keyword, position, search_volume, keyword_difficulty, intent, snapshot_date')
    .eq('client_id', clientId)
    .in('snapshot_date', [currentDate, previousDate])

  if (error) {
    throw new Error(`keyword_snapshots fetch failed: ${error.message}`)
  }

  const rows = (data ?? []) as KeywordSnapshotForChange[]
  return calculatePositionChanges(
    rows.filter(row => row.snapshot_date === currentDate),
    rows.filter(row => row.snapshot_date === previousDate),
  )
}

async function fetchLatestSnapshotDates(clientId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('keyword_snapshots')
    .select('snapshot_date')
    .eq('client_id', clientId)
    .order('snapshot_date', { ascending: false })
    .limit(500)

  if (error) {
    throw new Error(`keyword_snapshots date fetch failed: ${error.message}`)
  }

  return Array.from(new Set(
    ((data ?? []) as Array<{ snapshot_date: string }>).map(row => row.snapshot_date),
  )).slice(0, 2)
}

function buildChange(
  row: KeywordSnapshotForChange,
  changeType: PositionChangeType,
  previousPosition: number | null,
  currentPosition: number | null,
): PositionChange {
  return {
    keyword: row.keyword,
    change_type: changeType,
    previous_position: previousPosition,
    current_position: currentPosition,
    position_delta: previousPosition !== null && currentPosition !== null
      ? previousPosition - currentPosition
      : null,
    search_volume: row.search_volume,
    keyword_difficulty: row.keyword_difficulty,
    intent: row.intent,
  }
}

function sortChanges(changes: PositionChange[]): PositionChange[] {
  const weight: Record<PositionChangeType, number> = {
    new: 1,
    improved: 2,
    declined: 3,
    lost: 4,
  }

  return [...changes].sort((a, b) =>
    weight[a.change_type] - weight[b.change_type] ||
    Math.abs(b.position_delta ?? 0) - Math.abs(a.position_delta ?? 0) ||
    (b.search_volume ?? 0) - (a.search_volume ?? 0),
  )
}
