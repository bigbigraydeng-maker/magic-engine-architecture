/**
 * Phase 0.6 · SEED — Insert `magicengine_geo_baseline_v1` query set + 18 queries.
 *
 * Copies Roman v1 methodology (parser/rules/schema), NEW entity + NEW queries.
 * Locale/market carried on each query row; script invocation is a single
 * en-AU/au cohort (18 queries × 1 sample × ceiling $0.066 = $1.19 worst case).
 *
 * Idempotent: re-runs will short-circuit if the query_set_version already
 * exists for this client. No cost.
 */
import { supabaseAdmin } from '@/lib/supabase'

const CLIENT_ID = 'f1d062ca-929e-4b4e-ba6e-84752b748552'
const QSV = 'magicengine_geo_baseline_v1'
const LOCALE = 'en-AU'
const MARKET = 'au'
const CREATED_BY = 'phase0-2026-08-18-per-#1041'

// 18 queries, mapped to 5 clusters, each with a stated inclusion rationale.
// EN-only cohort — CN queries are a Phase 1 separate batch if PM authorizes.
const QUERIES: Array<{ key: string; text: string; cluster: string; why: string }> = [
  // brand_entity ×3 — must disambiguate from arcade/hardware "magic engine"
  { key: 'brand_1', text: 'what is Magic Engine the AI growth platform for small business',                    cluster: 'brand_entity',   why: 'Direct entity query with disambiguating tail; measures whether AI can distinguish us from arcade brand' },
  { key: 'brand_2', text: 'is Magic Engine legit for AI marketing in Australia',                                cluster: 'brand_entity',   why: 'Legitimacy check — measures whether owned reviews / press appear vs. absence' },
  { key: 'brand_3', text: 'Magic Engine AI marketing New Zealand reviews',                                      cluster: 'brand_entity',   why: 'Cross-market brand presence — validates whether NZ audiences see us at all' },
  // category ×4 — how are we shown when someone asks for the space?
  { key: 'cat_1',   text: 'best AI marketing platform for small business Australia 2026',                       cluster: 'category',       why: 'Peak commercial category query; measures whether we surface unaided' },
  { key: 'cat_2',   text: 'AI growth engine for SMB in Australia',                                              cluster: 'category',       why: 'Uses our positioning phrase; tests whether the phrase is neutral or already ours' },
  { key: 'cat_3',   text: 'AI marketing agency New Zealand',                                                    cluster: 'category',       why: 'NZ category recall — parallel to cat_1 to detect market split' },
  { key: 'cat_4',   text: 'AI-powered SEO platform for small business Australasia',                             cluster: 'category',       why: 'Adjacent-category framing (SEO not marketing); measures cross-vertical recall' },
  // problem ×4 — do we own the problems our product solves?
  { key: 'prob_1',  text: 'how do I get my business cited in ChatGPT answers',                                  cluster: 'problem',        why: 'Core GEO problem in ME language; measures whether we own the "solve" narrative' },
  { key: 'prob_2',  text: 'how to appear in Google AI Overviews for a local business in Australia',            cluster: 'problem',        why: 'Adjacent problem (AI Overview vs. answer engines); measures breadth of authority' },
  { key: 'prob_3',  text: 'how to be recommended by Perplexity for New Zealand small business',                 cluster: 'problem',        why: 'NZ + Perplexity — checks whether recommendation-engine authority extends by market and by engine' },
  { key: 'prob_4',  text: 'how to measure AI search visibility for my business',                                cluster: 'problem',        why: 'Measurement/tooling framing — our own product territory (matches the GEO Baseline we\'re running)' },
  // recommendation ×4 — when someone asks "who", do we appear?
  { key: 'rec_1',   text: 'who should I hire for AI SEO in Australia',                                          cluster: 'recommendation', why: 'AU services recall; measures whether we appear vs. traditional agencies' },
  { key: 'rec_2',   text: 'who is the best AI marketing consultant in Auckland',                                cluster: 'recommendation', why: 'NZ + city-specific + person-form ("consultant" not "agency") — tests owned-page vs. review-site dominance' },
  { key: 'rec_3',   text: 'best AI-first marketing platform for Australian SMBs',                               cluster: 'recommendation', why: 'Platform recommendation not services; separates SaaS narrative from service narrative' },
  { key: 'rec_4',   text: 'recommend an AI marketing tool that works for New Zealand small business',           cluster: 'recommendation', why: 'NZ SMB tool recommendation; conversational phrasing to test recommendation vs. list-recall behavior' },
  // comparison ×3 — case-study 0 needs baseline for "vs" queries
  { key: 'cmp_1',   text: 'Magic Engine vs traditional SEO agency for small business',                          cluster: 'comparison',     why: 'Direct branded comparison; measures whether we get to state our own case or a competitor states it for us' },
  { key: 'cmp_2',   text: 'AI marketing platform vs hiring a freelance marketer in Australia',                  cluster: 'comparison',     why: 'Category comparison against non-obvious substitute (freelancer, not agency); tests substitute recall' },
  { key: 'cmp_3',   text: 'automated marketing platform vs agency retainer for NZ small business',              cluster: 'comparison',     why: 'NZ + business-model comparison; measures whether the "automation replaces retainer" narrative is owned by us or a competitor' },
]

async function main() {
  console.log(`[phase0.6.seed] client=${CLIENT_ID} query_set_version=${QSV}`)
  console.log(`[phase0.6.seed] planned queries: ${QUERIES.length} (cohort: locale=${LOCALE} market=${MARKET})`)

  // 1. Check existence
  const { data: existing } = await supabaseAdmin
    .from('geo_query_sets')
    .select('id, query_set_version, locked_at')
    .eq('client_id', CLIENT_ID)
    .eq('query_set_version', QSV)
    .maybeSingle()

  let querySetId: string
  if (existing) {
    console.log(`[phase0.6.seed] query_set exists id=${existing.id} locked_at=${existing.locked_at ?? '(unlocked)'}`)
    querySetId = existing.id
  } else {
    const { data: created, error: qsErr } = await supabaseAdmin
      .from('geo_query_sets')
      .insert({ client_id: CLIENT_ID, query_set_version: QSV, created_by: CREATED_BY })
      .select('id')
      .single()
    if (qsErr) throw new Error(`geo_query_sets insert failed: ${qsErr.message}`)
    querySetId = created.id
    console.log(`[phase0.6.seed] geo_query_sets inserted id=${querySetId}`)
  }

  // 2. Upsert queries
  const rows = QUERIES.map(q => ({
    client_id: CLIENT_ID,
    query_set_id: querySetId,
    query_key: q.key,
    question_text: q.text,
    locale: LOCALE,
    market: MARKET,
    is_active: true,
  }))
  const { error: qErr, count } = await supabaseAdmin
    .from('geo_queries')
    .upsert(rows, { onConflict: 'query_set_id,query_key', count: 'exact' })
  if (qErr) throw new Error(`geo_queries upsert failed: ${qErr.message}`)
  console.log(`[phase0.6.seed] geo_queries upserted: ${count ?? rows.length}`)

  // 3. Print full seed manifest so the doc has it
  console.log('\n[phase0.6.seed] FULL SEED MANIFEST:')
  console.log(`  query_set_version: ${QSV}`)
  console.log(`  query_set_id:      ${querySetId}`)
  console.log(`  locale/market:     ${LOCALE} / ${MARKET}`)
  for (const q of QUERIES) {
    console.log(`  - [${q.cluster}/${q.key}] "${q.text}"`)
    console.log(`      why: ${q.why}`)
  }
  console.log(`\n[phase0.6.seed] DONE. Ready for scripts/geo-baseline-run.ts --live`)
}

main().catch(e => { console.error(e); process.exit(1) })
