/**
 * P31.X.2 — Goal primary metric auto-fetch
 *
 * Resolves a current_value for Goals whose primary_metric_key has
 * measurement='auto' (or 'hybrid'), by reading from already-cached ME data
 * sources or — for brand_search_volume — calling DataForSEO live.
 *
 * Supported metric keys (MVP):
 *   - organic_traffic    → ga4_traffic_snapshots.total_sessions (latest)
 *   - brand_search_volume→ DataForSEO bulkKeywordVolume live (replaces SEMrush;
 *                          SEMrush has been removed from ME stack 2026-06-03)
 *
 * Not yet supported (data source missing or complex):
 *   - form_submissions   → GA4 key_events (not stored in snapshot)
 *   - ai_visibility_score→ ai_visibility_snapshots (no 0-100 column yet)
 *   - conversion_rate    → derived GA4 (events/sessions)
 *   - social_followers_growth → no data source
 *   - cart_abandonment_rate → no data source
 *
 * Returns ok:false when unsupported or no data found.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { bulkKeywordVolume } from '@/lib/dataforseo/labs'
import { locationCodeForDb } from '@/lib/seo-intelligence/keyword-snapshots'

export type AutoFetchResult =
  | { ok: true;  value: number; source: string; snapshot_date: string; label: string }
  | { ok: false; reason: string }

/**
 * Attempt to auto-fetch a current value for the given metric key.
 *
 * @param supabase  Admin client
 * @param clientId  Client UUID
 * @param metricKey e.g. 'organic_traffic'
 */
export async function autoFetchMetricValue(
  supabase: SupabaseClient,
  clientId: string,
  metricKey: string,
): Promise<AutoFetchResult> {
  switch (metricKey) {
    case 'organic_traffic':
      return fetchOrganicTraffic(supabase, clientId)
    case 'brand_search_volume':
      return fetchBrandSearchVolume(supabase, clientId)
    default:
      return { ok: false, reason: `metric '${metricKey}' does not have an auto-fetch source yet` }
  }
}

// ── organic_traffic ────────────────────────────────────────────────────────

async function fetchOrganicTraffic(
  supabase: SupabaseClient,
  clientId: string,
): Promise<AutoFetchResult> {
  const { data, error } = await supabase
    .from('ga4_traffic_snapshots')
    .select('total_sessions, period_start, period_end')
    .eq('client_id', clientId)
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return { ok: false, reason: `GA4 query failed: ${error.message}` }
  }
  if (!data) {
    return { ok: false, reason: 'No GA4 snapshot found — run GA4 Sync first' }
  }
  if (typeof data.total_sessions !== 'number') {
    return { ok: false, reason: 'GA4 snapshot missing total_sessions value' }
  }

  return {
    ok: true,
    value: data.total_sessions,
    source: 'GA4 (28-day sessions)',
    snapshot_date: data.period_end as string,
    label: `${data.total_sessions.toLocaleString()} sessions (${formatDate(data.period_start as string)} → ${formatDate(data.period_end as string)})`,
  }
}

// ── brand_search_volume ────────────────────────────────────────────────────

async function fetchBrandSearchVolume(
  supabase: SupabaseClient,
  clientId: string,
): Promise<AutoFetchResult> {
  // Schema reality (2026-06-03 audit): clients table has `name` + `semrush_db`
  // (au/nz) but no `primary_keyword` column. Use `name` as the brand keyword.
  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('name, semrush_db')
    .eq('id', clientId)
    .maybeSingle<{ name: string | null; semrush_db: string | null }>()

  if (clientErr) {
    return { ok: false, reason: `Client query failed: ${clientErr.message}` }
  }
  if (!client) {
    return { ok: false, reason: 'Client not found' }
  }

  const brandKeyword = client.name
  if (!brandKeyword) {
    return { ok: false, reason: 'Client has no name — cannot look up brand search volume' }
  }

  // SEMrush has been removed from the ME stack (2026-06-03). Call DataForSEO
  // bulkKeywordVolume live so we don't depend on the empty keyword_snapshots
  // table — the SEMrush ingestion cron never ran, and DataForSEO is the
  // canonical replacement.
  const locationCode = locationCodeForDb(client.semrush_db)
  let labsResults
  try {
    labsResults = await bulkKeywordVolume([brandKeyword], locationCode)
  } catch (err) {
    return {
      ok: false,
      reason: `DataForSEO bulkKeywordVolume failed: ${(err as Error).message}`,
    }
  }

  const hit = labsResults.find(r => r.keyword.toLowerCase() === brandKeyword.toLowerCase())
    ?? labsResults[0]
  if (!hit || hit.search_volume == null) {
    return {
      ok: false,
      reason: `DataForSEO returned no search_volume for "${brandKeyword}" (location ${locationCode})`,
    }
  }

  return {
    ok: true,
    value: hit.search_volume,
    source: 'DataForSEO bulk keyword volume',
    snapshot_date: new Date().toISOString(),
    label: `${hit.search_volume.toLocaleString()} searches/mo for "${hit.keyword}"`,
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
}
