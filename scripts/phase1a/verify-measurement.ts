/**
 * Phase 1A verifier — safe to re-run any time.
 *
 * Checks (in order):
 *   1. client_connectors row for magicengine — anchor='gsc' or 'ga4' present?
 *   2. platform_oauth_connections row for magicengine — google_gsc token active?
 *   3. gsc_performance_snapshots — any row for site_url matching magicengine?
 *   4. ga4_traffic_snapshots — any row for client_id?
 *   5. If GSC connector connected + token active + site_url set → try one live
 *      pullback via lib/gsc/client.fetchGscSnapshot (last 7 days).
 *
 * Reads only; the pullback attempt writes to gsc_performance_snapshots only
 * if fetch succeeds. Prints a status table; safe to run before or after PM
 * completes the OAuth + GA4 setup.
 *
 * Usage: npx tsx --env-file=.env.local scripts/phase1a/verify-measurement.ts
 */
import { supabaseAdmin } from '@/lib/supabase'
import { fetchGscSnapshot, GscApiError } from '@/lib/gsc/client'

const CLIENT_ID = 'f1d062ca-929e-4b4e-ba6e-84752b748552'
const DOMAIN = 'magicengine.com.au'

async function main() {
  console.log(`[phase1a.verify] client=${CLIENT_ID} domain=${DOMAIN}`)
  console.log('─'.repeat(72))

  // 1. Connectors
  const { data: connectors } = await supabaseAdmin
    .from('client_connectors')
    .select('anchor, status, config, connected_at, updated_at')
    .eq('client_id', CLIENT_ID)
  console.log(`[1] client_connectors rows: ${(connectors ?? []).length}`)
  for (const c of connectors ?? []) {
    console.log(`     ${c.anchor}: status=${c.status} site_url=${(c.config as {site_url?: string})?.site_url ?? '(none)'} connected_at=${c.connected_at ?? '(null)'}`)
  }
  const gscConn = (connectors ?? []).find(c => c.anchor === 'gsc')
  const ga4Conn = (connectors ?? []).find(c => c.anchor === 'ga4')

  // 2. OAuth tokens
  const { data: tokens } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('provider, status, display_name, scopes, token_expiry')
    .eq('client_id', CLIENT_ID)
    .in('provider', ['google_gsc', 'google_ga4', 'google'])
  console.log(`[2] platform_oauth_connections rows: ${(tokens ?? []).length}`)
  for (const t of tokens ?? []) {
    console.log(`     ${t.provider}: status=${t.status} display=${t.display_name ?? '(none)'} expires=${t.token_expiry ?? '(null)'} scopes=${(t.scopes ?? []).length}`)
  }

  // 3. Existing GSC snapshots
  const { count: gscCount } = await supabaseAdmin
    .from('gsc_performance_snapshots')
    .select('id', { count: 'exact', head: true })
    .ilike('site_url', `%${DOMAIN}%`)
  console.log(`[3] gsc_performance_snapshots rows matching ${DOMAIN}: ${gscCount ?? 0}`)

  // 4. Existing GA4 snapshots
  const { count: ga4Count } = await supabaseAdmin
    .from('ga4_traffic_snapshots')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', CLIENT_ID)
  console.log(`[4] ga4_traffic_snapshots rows: ${ga4Count ?? 0}`)

  // 5. Live GSC pullback probe — only if all preconditions met
  const gscReady = gscConn?.status === 'connected' && (gscConn.config as {site_url?: string})?.site_url
  const oauthReady = (tokens ?? []).some(t => t.provider === 'google_gsc' && t.status === 'active')

  console.log(`─`.repeat(72))
  console.log(`Preconditions:`)
  console.log(`   GSC connector connected + site_url set: ${gscReady ? '✅' : '❌'}`)
  console.log(`   Google OAuth token active:              ${oauthReady ? '✅' : '❌'}`)

  if (!gscReady || !oauthReady) {
    console.log(`\n[5] Skipping live pullback — preconditions not met. See runbook §2 for PM steps.`)
    return
  }

  const siteUrl = (gscConn.config as {site_url: string}).site_url
  console.log(`\n[5] Attempting live GSC pullback for ${siteUrl}...`)
  try {
    const snapshot = await fetchGscSnapshot({ clientId: CLIENT_ID, siteUrl, periodDays: 7 })
    console.log(`     ✅ Snapshot fetched: totalClicks=${snapshot.total_clicks} totalImpressions=${snapshot.total_impressions}`)
    console.log(`     Persist to DB: use POST /api/clients/${CLIENT_ID}/gsc/sync to store an official snapshot row`)
  } catch (err) {
    const msg = err instanceof GscApiError ? `GscApiError: ${err.message}` : String(err)
    console.log(`     ❌ Pullback failed: ${msg}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
