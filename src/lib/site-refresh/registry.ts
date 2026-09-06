/**
 * Read a client's site cache-refresh registration from Supabase
 * (client_site_platforms). This is the single source of truth for
 * "where does customer X's site live and how do I purge its cache".
 *
 * No environment variables — adding a new customer site is one
 * INSERT INTO client_site_platforms plus one GitHub webhook URL.
 */

import { supabaseAdmin } from '@/lib/supabase'

export interface ClientSitePlatform {
  readonly client_id: string
  readonly github_repo: string
  readonly origin_url: string
  readonly cloudflare_zone_id: string
  readonly revalidate_secret: string
}

interface PlatformRow {
  client_id: string
  github_repo: string
  origin_url: string
  cloudflare_zone_id: string
  revalidate_secret: string
}

export async function getSitePlatformByRepo(
  githubRepo: string,
): Promise<ClientSitePlatform | null> {
  const { data, error } = await supabaseAdmin
    .from('client_site_platforms')
    .select('client_id, github_repo, origin_url, cloudflare_zone_id, revalidate_secret')
    .eq('github_repo', githubRepo)
    .maybeSingle<PlatformRow>()
  if (error) throw new Error(`registry_lookup_failed: ${error.message}`)
  return data
}

export async function getSitePlatformByClientId(
  clientId: string,
): Promise<ClientSitePlatform | null> {
  const { data, error } = await supabaseAdmin
    .from('client_site_platforms')
    .select('client_id, github_repo, origin_url, cloudflare_zone_id, revalidate_secret')
    .eq('client_id', clientId)
    .maybeSingle<PlatformRow>()
  if (error) throw new Error(`registry_lookup_failed: ${error.message}`)
  return data
}
