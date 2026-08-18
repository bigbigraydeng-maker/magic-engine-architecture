/**
 * Phase 0.5 — DataForSEO bounded probe for Magic Engine (AU + NZ)
 *
 * Validates or invalidates the cluster hypotheses in #1039 §15 with real
 * volume/KD/SERP data. Hard cost cap: US$4.00.
 *
 * Writes:
 *   - keyword_snapshots (with source='dataforseo_probe_2026-08-18')
 *   - competitor_keyword_snapshots (top-10 competitors per location)
 * Reads: DataForSEO Labs (paid), 12 API calls at ~$0.06-0.08 each.
 *
 * Usage: npx tsx --env-file=.env.local scripts/phase0/dataforseo-probe.ts
 */
import { supabaseAdmin } from '@/lib/supabase'
import { getKeywordIdeas, getSerpCompetitors } from '@/lib/dataforseo/labs'
import { writeFileSync } from 'node:fs'

const CLIENT_ID = 'f1d062ca-929e-4b4e-ba6e-84752b748552'
const DOMAIN = 'magicengine.com.au'
const SOURCE_TAG = 'dataforseo_probe_2026-08-18'
const HARD_CAP_USD = 4.00

// One seed per cluster (per #1039 §15 / doc §6). Keep tight — probe validates,
// doesn't over-explore.
const CLUSTERS: Array<{ key: string; seed: string; intent_desc: string }> = [
  { key: 'brand_entity',   seed: 'magic engine ai',              intent_desc: 'Brand disambiguation (arcade/hardware collision risk)' },
  { key: 'category',       seed: 'ai marketing platform',        intent_desc: 'Category — AI marketing / growth platform' },
  { key: 'problem',        seed: 'ai search visibility',         intent_desc: 'Problem — how to appear in AI answers' },
  { key: 'recommendation', seed: 'best ai marketing agency',     intent_desc: 'Recommendation — who to hire' },
  { key: 'comparison',     seed: 'ai marketing vs seo agency',   intent_desc: 'Comparison — us vs alternatives' },
]

const LOCATIONS: Array<{ code: number; label: string }> = [
  { code: 2036, label: 'au' },
  { code: 2554, label: 'nz' },
]

// Per-endpoint pricing (from DataForSEO public rate card, subject to actual receipt below).
const PRICE_PER_KEYWORD_IDEAS_CALL = 0.075   // Labs keyword_ideas
const PRICE_PER_COMPETITORS_CALL   = 0.06    // Labs competitors_domain

async function main() {
  const runId = crypto.randomUUID()
  const snapshotDate = new Date().toISOString().slice(0, 10)
  const measuredAtIso = new Date().toISOString()
  console.log(`[phase0.5] run=${runId} cap=US$${HARD_CAP_USD.toFixed(2)}`)

  let estimatedCost = 0
  const receipts: Array<{ endpoint: string; args: string; cost: number; rows: number }> = []
  const perCluster: Record<string, { au: number; nz: number; median_vol_au?: number; median_kd_au?: number; median_vol_nz?: number; median_kd_nz?: number; top_kw_au?: string[]; top_kw_nz?: string[] }> = {}
  const competitors: Record<string, Array<{ domain: string; intersections: number; avg_position: number | null }>> = {}

  // ── Cluster keyword_ideas — 5 × 2 = 10 calls
  for (const cluster of CLUSTERS) {
    perCluster[cluster.key] = { au: 0, nz: 0 }
    for (const loc of LOCATIONS) {
      const projectedNext = estimatedCost + PRICE_PER_KEYWORD_IDEAS_CALL
      if (projectedNext > HARD_CAP_USD) {
        console.error(`[phase0.5] would exceed cap (US$${projectedNext.toFixed(3)} > US$${HARD_CAP_USD}); STOPPING before ${cluster.key}/${loc.label}`)
        break
      }
      console.log(`[phase0.5] keyword_ideas cluster=${cluster.key} loc=${loc.label} seed="${cluster.seed}"`)
      const rows = await getKeywordIdeas(cluster.seed, loc.code, 25)
      estimatedCost += PRICE_PER_KEYWORD_IDEAS_CALL
      receipts.push({ endpoint: 'labs/keyword_ideas', args: `${cluster.seed}|${loc.code}`, cost: PRICE_PER_KEYWORD_IDEAS_CALL, rows: rows.length })
      perCluster[cluster.key][loc.label as 'au' | 'nz'] = rows.length
      const vols  = rows.map(r => r.search_volume ?? 0).sort((a, b) => a - b)
      const kds   = rows.map(r => r.keyword_difficulty ?? 0).sort((a, b) => a - b)
      const median = (a: number[]) => a.length ? a[Math.floor(a.length / 2)] : 0
      const key = loc.label as 'au' | 'nz'
      perCluster[cluster.key][`median_vol_${key}`] = median(vols) as never
      perCluster[cluster.key][`median_kd_${key}`]  = median(kds) as never
      perCluster[cluster.key][`top_kw_${key}`] = rows.slice(0, 5).map(r => r.keyword) as never

      // Persist rows into keyword_snapshots so §0.7 receipt reflects DB truth
      const dbRows = rows
        .filter(r => r.keyword.trim().length > 0)
        .map(r => ({
          client_id: CLIENT_ID,
          domain: DOMAIN,
          keyword: r.keyword,
          position: r.position ?? null,
          search_volume: r.search_volume,
          keyword_difficulty: r.keyword_difficulty,
          cpc: r.cpc,
          competition: r.competition,
          intent: r.intent,
          source: SOURCE_TAG,
          location_code: loc.code,
          semrush_db: loc.label,
          snapshot_date: snapshotDate,
          measured_at: measuredAtIso,
          local_pack_rank: null,
        }))
      if (dbRows.length) {
        const { error } = await supabaseAdmin.from('keyword_snapshots').upsert(dbRows, { onConflict: 'client_id,keyword,location_code,snapshot_date' })
        if (error) console.error(`[phase0.5] keyword_snapshots upsert failed for ${cluster.key}/${loc.label}:`, error.message)
      }
    }
  }

  // ── Competitor lookup — 1 × 2 = 2 calls
  for (const loc of LOCATIONS) {
    const projectedNext = estimatedCost + PRICE_PER_COMPETITORS_CALL
    if (projectedNext > HARD_CAP_USD) {
      console.error(`[phase0.5] would exceed cap; skipping competitors ${loc.label}`)
      break
    }
    console.log(`[phase0.5] competitors_domain domain=${DOMAIN} loc=${loc.label}`)
    const comps = await getSerpCompetitors(DOMAIN, loc.code, 15)
    estimatedCost += PRICE_PER_COMPETITORS_CALL
    receipts.push({ endpoint: 'labs/competitors_domain', args: `${DOMAIN}|${loc.code}`, cost: PRICE_PER_COMPETITORS_CALL, rows: comps.length })
    competitors[loc.label] = comps.slice(0, 10).map(c => ({ domain: c.domain ?? '', intersections: c.intersections ?? 0, avg_position: c.avg_position ?? null }))
  }

  const receipt = {
    run_id: runId,
    started_at: measuredAtIso,
    domain: DOMAIN,
    client_id: CLIENT_ID,
    hard_cap_usd: HARD_CAP_USD,
    estimated_total_cost_usd: Number(estimatedCost.toFixed(4)),
    endpoint_receipts: receipts,
    per_cluster: perCluster,
    competitors,
  }
  console.log('\n[phase0.5] RECEIPT:\n' + JSON.stringify(receipt, null, 2))
  writeFileSync('scripts/phase0/receipts/dataforseo-probe-2026-08-18.json', JSON.stringify(receipt, null, 2))
  console.log('\n[phase0.5] receipt saved to scripts/phase0/receipts/dataforseo-probe-2026-08-18.json')
}

main().catch(e => { console.error(e); process.exit(1) })
