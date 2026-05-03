/**
 * Blog Topic Selector — GEO mode
 *
 * Reads AI Tracker run history and identifies queries where the client brand
 * is consistently weak (not mentioned, or ranked outside top 3).
 * These become the highest-priority blog topics for the GEO-mode MVP.
 *
 * Reference: ROADMAP.md P7.3.2, ARCHITECTURE.md §13.2
 */

import { supabaseAdmin } from '../supabase'
import type { BlogOpportunity } from '@/types/magic-engine'

interface QueryRunSummary {
  query_id: string
  question: string
  total_runs: number
  weak_runs: number            // runs where brand rank was null or > 3
  engines_missing: Set<string>
  last_run_at: string | null
}

/**
 * Return blog topic opportunities sorted by weakness score (highest first).
 * A query is "weak" if the client brand ranked > 3 or was not mentioned at all.
 *
 * @param clientId  - client UUID
 * @param limit     - max opportunities to return (default 20)
 * @param lookback  - how many recent runs per query to consider (default 10)
 */
export async function getWeakSpotOpportunities(
  clientId: string,
  limit = 20,
  lookback = 10
): Promise<BlogOpportunity[]> {
  // 1. Load enabled queries for this client
  const { data: queries, error: qErr } = await supabaseAdmin
    .from('ai_visibility_queries')
    .select('id, question')
    .eq('client_id', clientId)
    .eq('enabled', true)
    .order('created_at', { ascending: true })

  if (qErr || !queries || queries.length === 0) return []

  const queryIds = queries.map((q: { id: string }) => q.id)
  const questionMap = new Map<string, string>(
    queries.map((q: { id: string; question: string }) => [q.id, q.question])
  )

  // 2. Load recent runs for all queries (client_brand_rank + engine + ran_at)
  const { data: runs, error: rErr } = await supabaseAdmin
    .from('ai_visibility_runs')
    .select('query_id, ai_engine, client_brand_rank, ran_at')
    .eq('client_id', clientId)
    .in('query_id', queryIds)
    .order('ran_at', { ascending: false })
    .limit(queryIds.length * lookback)

  if (rErr || !runs) return []

  // 3. Aggregate: for each query, track runs seen and weak runs
  const summaryMap = new Map<string, QueryRunSummary>()

  for (const queryId of queryIds) {
    summaryMap.set(queryId, {
      query_id: queryId,
      question: questionMap.get(queryId) ?? '',
      total_runs: 0,
      weak_runs: 0,
      engines_missing: new Set(),
      last_run_at: null,
    })
  }

  // Count per-query, respecting the lookback window per query
  const perQueryCount = new Map<string, number>()

  for (const run of runs as Array<{
    query_id: string
    ai_engine: string
    client_brand_rank: number | null
    ran_at: string
  }>) {
    const seen = perQueryCount.get(run.query_id) ?? 0
    if (seen >= lookback) continue
    perQueryCount.set(run.query_id, seen + 1)

    const summary = summaryMap.get(run.query_id)
    if (!summary) continue

    summary.total_runs++
    if (!summary.last_run_at || run.ran_at > summary.last_run_at) {
      summary.last_run_at = run.ran_at
    }

    const isWeak = run.client_brand_rank === null || run.client_brand_rank > 3
    if (isWeak) {
      summary.weak_runs++
      summary.engines_missing.add(run.ai_engine)
    }
  }

  // 4. Convert to BlogOpportunity, filter out queries with no runs
  const opportunities: BlogOpportunity[] = []

  for (const summary of Array.from(summaryMap.values())) {
    if (summary.total_runs === 0) continue

    const weaknessScore = summary.weak_runs / summary.total_runs

    // Only surface queries where brand is weak in at least half of runs
    if (weaknessScore < 0.3) continue

    opportunities.push({
      query_id: summary.query_id,
      query_text: summary.question,
      weakness_score: Math.round(weaknessScore * 100) / 100,
      engines_missing: Array.from(summary.engines_missing),
      total_runs_checked: summary.total_runs,
      last_run_at: summary.last_run_at,
      mode: 'geo_only',
    })
  }

  // 5. Sort by weakness_score DESC, then by engines_missing count DESC
  opportunities.sort((a, b) => {
    if (b.weakness_score !== a.weakness_score) return b.weakness_score - a.weakness_score
    return b.engines_missing.length - a.engines_missing.length
  })

  return opportunities.slice(0, limit)
}
