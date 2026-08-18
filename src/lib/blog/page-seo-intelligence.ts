/**
 * page-seo-intelligence.ts
 *
 * Fetches real SEO + GEO signals for a specific page from:
 *   1. serp_rankings — keyword positions tracked for this page's URL
 *   2. GEO gaps — previously sourced from ai-tracker (system B), now
 *      decommissioned (spec 2026-08-19-ai-tracker-decommission-v1.md, 组 H).
 *      Contributes no GEO gaps until M1 (geo_*) re-wire (P31.X.4).
 *
 * Used by upgrade-generator to build data-driven weakness signals instead of
 * the original simple heuristics (word_count < 500 / has_geo_block).
 */

import { supabaseAdmin } from '@/lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SerpKeywordSignal {
  keyword:       string
  position:      number | null   // null = not ranking
  search_volume: number | null
}

export interface GeoGapSignal {
  question:   string
  brand_rank: number | null   // null = brand not mentioned at all
}

export interface PageSeoIntelligence {
  // SERP data for this page URL
  ranking_keywords: SerpKeywordSignal[]
  has_serp_data:    boolean

  // GEO / AI visibility gaps (client-level, recent runs)
  geo_gaps:     GeoGapSignal[]
  geo_avg_rank: number | null   // from latest ai_visibility_snapshot
  has_geo_data: boolean

  // Pre-built weakness strings ready for injection into the Claude prompt
  weakness_signals: string[]
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function getPageSeoIntelligence(
  clientId: string,
  pageUrl:  string,
): Promise<PageSeoIntelligence> {
  const [serpResult, geoResult] = await Promise.allSettled([
    fetchSerpRankings(clientId, pageUrl),
    fetchGeoGaps(clientId),
  ])

  const rankingKeywords = serpResult.status === 'fulfilled' ? serpResult.value : []
  const { gaps: geoGaps, avgRank: geoAvgRank } =
    geoResult.status === 'fulfilled'
      ? geoResult.value
      : { gaps: [] as GeoGapSignal[], avgRank: null }

  const weaknessSignals = buildWeaknessSignals(rankingKeywords, geoGaps, geoAvgRank)

  return {
    ranking_keywords: rankingKeywords,
    has_serp_data:    rankingKeywords.length > 0,
    geo_gaps:         geoGaps,
    geo_avg_rank:     geoAvgRank,
    has_geo_data:     geoGaps.length > 0 || geoAvgRank !== null,
    weakness_signals: weaknessSignals,
  }
}

// ─── SERP fetcher ─────────────────────────────────────────────────────────────

async function fetchSerpRankings(
  clientId: string,
  pageUrl:  string,
): Promise<SerpKeywordSignal[]> {
  // Normalise URL: strip trailing slash for consistent matching
  const normUrl = pageUrl.replace(/\/$/, '')

  // Latest snapshot date for this client + URL combination
  const { data: dateRow } = await supabaseAdmin
    .from('serp_rankings')
    .select('date')
    .eq('client_id', clientId)
    .ilike('url', `${normUrl}%`)
    .order('date', { ascending: false })
    .limit(1)
    .single()

  if (!dateRow) return []

  const { data: rows } = await supabaseAdmin
    .from('serp_rankings')
    .select('keyword, position, search_volume')
    .eq('client_id', clientId)
    .eq('date', dateRow.date)
    .ilike('url', `${normUrl}%`)
    .order('position', { ascending: true, nullsFirst: false })
    .limit(20)

  return (rows ?? []).map(r => ({
    keyword:       r.keyword as string,
    position:      r.position as number | null,
    search_volume: r.search_volume as number | null,
  }))
}

// ─── GEO / AI visibility fetcher ──────────────────────────────────────────────

async function fetchGeoGaps(
  _clientId: string,
): Promise<{ gaps: GeoGapSignal[]; avgRank: number | null }> {
  // ai-tracker (system B) decommissioned — the `ai_visibility_snapshots` /
  // `ai_visibility_runs` / `ai_visibility_queries` sources for GEO gap signals
  // are gone (spec 2026-08-19-ai-tracker-decommission-v1.md, 组 H). Until M1
  // (geo_*) re-wire (P31.X.4), page SEO intelligence contributes no GEO gaps
  // (SEO/SERP signals below are unaffected). Callers wrap this in `.catch`, so
  // empty gaps degrade gracefully.
  return { gaps: [], avgRank: null }
}

// ─── Weakness signal builder ───────────────────────────────────────────────────

function buildWeaknessSignals(
  keywords: SerpKeywordSignal[],
  geoGaps:  GeoGapSignal[],
  avgRank:  number | null,
): string[] {
  const signals: string[] = []

  // ── SERP signals ──────────────────────────────────────────────────────────
  if (keywords.length === 0) {
    signals.push('SERP: page has no tracked keyword rankings — build topical authority to earn first-page positions')
  } else {
    const page2Plus = keywords.filter(k => (k.position ?? 99) > 10)
    const page1     = keywords.filter(k => (k.position ?? 99) <= 10)

    for (const kw of page2Plus.slice(0, 3)) {
      const vol = kw.search_volume ? ` (${kw.search_volume.toLocaleString()} searches/mo)` : ''
      signals.push(
        `SERP: ranking #${kw.position} for "${kw.keyword}"${vol} — expand content depth to break into top 10`,
      )
    }

    for (const kw of page1.slice(0, 2)) {
      const vol = kw.search_volume ? ` (${kw.search_volume.toLocaleString()} searches/mo)` : ''
      signals.push(
        `SERP: ranking #${kw.position} for "${kw.keyword}"${vol} — strengthen content to defend and improve position`,
      )
    }
  }

  // ── GEO signals ───────────────────────────────────────────────────────────
  if (avgRank !== null) {
    const score = Math.round(100 - Math.min(avgRank * 10, 100))
    signals.push(`GEO: AI visibility score ${score}/100 (avg brand rank: ${avgRank.toFixed(1)}) — add GEO signals to lift AI citations`)
  }

  for (const gap of geoGaps.slice(0, 3)) {
    if (gap.brand_rank === null) {
      signals.push(`GEO: brand NOT mentioned by AI for "${gap.question}" — FAQ + entity signals can fix this`)
    } else {
      signals.push(`GEO: brand ranked #${gap.brand_rank} (weak) for "${gap.question}" — need stronger entity signals`)
    }
  }

  if (signals.length === 0) {
    signals.push('general quality improvement for SEO + AI visibility')
  }

  return signals
}
