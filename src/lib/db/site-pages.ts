/**
 * Database helpers for the client_site_pages table.
 *
 * countSitePages      — total page count for a client (throws on error)
 * countGeoDetectedPages — count of pages with has_geo_block=true (returns 0 on error,
 *                         non-fatal so it never breaks the status endpoint)
 */

import { supabaseAdmin } from '@/lib/supabase'

/**
 * Returns the total number of crawled pages for the given client.
 * Throws if the DB query fails (use for metrics where accuracy matters).
 */
export async function countSitePages(clientId: string): Promise<number> {
  if (!clientId) return 0
  const { count, error } = await supabaseAdmin
    .from('client_site_pages')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
  if (error) throw error
  return count ?? 0
}

/**
 * Returns the number of pages that have a GEO block detected.
 * Returns 0 on any DB error — non-fatal by design so callers don't need try/catch.
 */
export async function countGeoDetectedPages(clientId: string): Promise<number> {
  if (!clientId) return 0
  const { count, error } = await supabaseAdmin
    .from('client_site_pages')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('has_geo_block', true)
  if (error) return 0
  return count ?? 0
}
