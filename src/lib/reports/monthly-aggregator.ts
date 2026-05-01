/**
 * Monthly Report Aggregator
 *
 * Pulls data from ai_visibility_snapshots, ai_visibility_runs, geo_directives,
 * and blog_posts to build a complete MonthlyReportData object.
 *
 * Reference: ROADMAP.md P7.4.1–P7.4.5, ARCHITECTURE.md §12, §13
 */

import { supabaseAdmin } from '../supabase'
import type { BrandMention } from '@/types/magic-engine'

// ── Output types ──────────────────────────────────────────────────────────────

export interface MonthlyOverview {
  this_month_avg_rank: number | null
  last_month_avg_rank: number | null
  /** positive = rank worsened, negative = rank improved */
  rank_change: number | null
  this_month_mentions: number
  last_month_mentions: number
  mention_change: number
  queries_tracked: number
  engines_used: string[]
}

export interface TrendPoint {
  week_of: string
  avg_rank: number | null
  mentions_count: number
}

export interface GeoDeploymentInfo {
  active_version: number | null
  directive_id: string | null
  deployed_pages: string[]
  deployed_pages_count: number
  published_blogs_this_month: number
}

export interface CompetitiveRow {
  question: string
  query_id: string
  client_rank: number | null
  competitors: Array<{ brand: string; rank: number }>
  engine: string
  run_at: string
}

export interface MonthlyReportData {
  client_id: string
  client_name: string
  period_label: string   // e.g. "May 2026"
  period_from: string    // ISO date string
  period_to: string      // ISO date string
  overview: MonthlyOverview
  trend: TrendPoint[]    // 4 points, oldest → newest (for sparkline)
  geo: GeoDeploymentInfo
  competitive: CompetitiveRow[]
  generated_at: string
}

// ── Internal helpers ──────────────────────────────────────────────────────────

type SnapshotRow = {
  week_of: string
  avg_rank: number | null
  mentions_count: number
  total_runs: number
  models_covered: string[] | null
}

function avgRank(snaps: SnapshotRow[]): number | null {
  const valid = snaps.filter(s => s.avg_rank != null)
  if (valid.length === 0) return null
  const sum = valid.reduce((acc, s) => acc + (s.avg_rank ?? 0), 0)
  return Math.round((sum / valid.length) * 10) / 10
}

function sumMentions(snaps: SnapshotRow[]): number {
  return snaps.reduce((acc, s) => acc + (s.mentions_count ?? 0), 0)
}

// ── Main aggregator ───────────────────────────────────────────────────────────

export async function buildMonthlyReport(clientId: string): Promise<MonthlyReportData> {
  const now = new Date()

  // Period boundaries
  const periodTo   = now.toISOString().split('T')[0]
  const periodFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const lastFrom   = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0]
  const lastTo     = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0]
  const periodLabel = now.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })

  // ── 1. Client name ─────────────────────────────────────────────────────────
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('name')
    .eq('id', clientId)
    .single<{ name: string }>()

  const clientName = client?.name ?? 'Unknown Client'

  // ── 2. Snapshots (up to 8 weeks = 2 months) ────────────────────────────────
  const { data: snapsRaw } = await supabaseAdmin
    .from('ai_visibility_snapshots')
    .select('week_of, avg_rank, mentions_count, total_runs, models_covered')
    .eq('client_id', clientId)
    .order('week_of', { ascending: false })
    .limit(8)

  const snaps: SnapshotRow[] = (snapsRaw ?? []) as SnapshotRow[]

  const thisSnaps = snaps.filter(s => s.week_of >= periodFrom && s.week_of <= periodTo)
  const lastSnaps = snaps.filter(s => s.week_of >= lastFrom && s.week_of <= lastTo)

  // Fallback: if no month-scoped snaps, use latest 4 vs prior 4
  const thisUsed = thisSnaps.length > 0 ? thisSnaps : snaps.slice(0, 4)
  const lastUsed = lastSnaps.length > 0 ? lastSnaps : snaps.slice(4, 8)

  const thisAvg = avgRank(thisUsed)
  const lastAvg = avgRank(lastUsed)
  const rankChange =
    thisAvg != null && lastAvg != null
      ? Math.round((thisAvg - lastAvg) * 10) / 10
      : null

  const thisMentions = sumMentions(thisUsed)
  const lastMentions = sumMentions(lastUsed)

  const engines = Array.from(new Set(snaps.flatMap(s => s.models_covered ?? [])))

  // ── 3. Queries tracked ─────────────────────────────────────────────────────
  const { count: queriesCount } = await supabaseAdmin
    .from('ai_visibility_queries')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('enabled', true)

  // ── 4. Trend (4 points, oldest first for chart left→right) ────────────────
  const trendSnaps = snaps.slice(0, 4).reverse()
  const trend: TrendPoint[] = trendSnaps.map(s => ({
    week_of:       s.week_of,
    avg_rank:      s.avg_rank,
    mentions_count: s.mentions_count,
  }))

  // ── 5. GEO directive ───────────────────────────────────────────────────────
  const { data: geo } = await supabaseAdmin
    .from('geo_directives')
    .select('id, version, deployed_pages')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .maybeSingle<{ id: string; version: number; deployed_pages: string[] }>()

  const { count: publishedBlogs } = await supabaseAdmin
    .from('blog_posts')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('status', 'published')
    .gte('published_at', periodFrom)

  // ── 6. Competitive comparison ──────────────────────────────────────────────
  const { data: queries } = await supabaseAdmin
    .from('ai_visibility_queries')
    .select('id, question')
    .eq('client_id', clientId)
    .eq('enabled', true)
    .order('created_at', { ascending: true })
    .limit(10)

  const competitive: CompetitiveRow[] = []

  if (queries && queries.length > 0) {
    const queryIds = queries.map((q: { id: string }) => q.id)
    const questionMap = new Map<string, string>(
      queries.map((q: { id: string; question: string }) => [q.id, q.question])
    )

    const { data: runs } = await supabaseAdmin
      .from('ai_visibility_runs')
      .select('query_id, ai_engine, client_brand_rank, brands_mentioned, ran_at')
      .eq('client_id', clientId)
      .in('query_id', queryIds)
      .order('ran_at', { ascending: false })
      .limit(queryIds.length * 4)

    const seenQueries = new Set<string>()

    for (const run of (runs ?? []) as Array<{
      query_id: string
      ai_engine: string
      client_brand_rank: number | null
      brands_mentioned: BrandMention[] | null
      ran_at: string
    }>) {
      if (seenQueries.has(run.query_id)) continue
      seenQueries.add(run.query_id)

      const competitors = (run.brands_mentioned ?? [])
        .filter(b => b.brand && b.rank != null)
        .sort((a, b) => a.rank - b.rank)
        .slice(0, 5)
        .map(b => ({ brand: b.brand, rank: b.rank }))

      competitive.push({
        question:    questionMap.get(run.query_id) ?? '',
        query_id:    run.query_id,
        client_rank: run.client_brand_rank,
        competitors,
        engine:      run.ai_engine,
        run_at:      run.ran_at,
      })
    }

    // Fill in queries with no runs (show as unknown)
    for (const q of queries as Array<{ id: string; question: string }>) {
      if (!seenQueries.has(q.id)) {
        competitive.push({
          question:    q.question,
          query_id:    q.id,
          client_rank: null,
          competitors: [],
          engine:      '—',
          run_at:      '',
        })
      }
    }
  }

  // ── Assemble ───────────────────────────────────────────────────────────────
  return {
    client_id:    clientId,
    client_name:  clientName,
    period_label: periodLabel,
    period_from:  periodFrom,
    period_to:    periodTo,
    overview: {
      this_month_avg_rank:  thisAvg,
      last_month_avg_rank:  lastAvg,
      rank_change:          rankChange,
      this_month_mentions:  thisMentions,
      last_month_mentions:  lastMentions,
      mention_change:       thisMentions - lastMentions,
      queries_tracked:      queriesCount ?? 0,
      engines_used:         engines,
    },
    trend,
    geo: {
      active_version:           geo?.version ?? null,
      directive_id:             geo?.id ?? null,
      deployed_pages:           geo?.deployed_pages ?? [],
      deployed_pages_count:     (geo?.deployed_pages ?? []).length,
      published_blogs_this_month: publishedBlogs ?? 0,
    },
    competitive,
    generated_at: now.toISOString(),
  }
}
