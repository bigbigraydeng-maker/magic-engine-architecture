/**
 * Bind a specific GA4 property to a client (Settings picker write path).
 *
 * Mirrors gbp/location.ts's setGbpLocation, minus the cross-client
 * exclusivity check — a GA4 property visible to more than one ME client is
 * a normal business-structure fact (e.g. shared agency access), not a
 * data-integrity risk the way two clients posting to one GBP storefront
 * would be. See docs/specs/2026-08-11-onboarding-integrations-unify-v1.md §2.4.
 */

import { supabaseAdmin } from '@/lib/supabase'

export async function setGa4Property(
  clientId: string,
  property: string,
): Promise<{ ok: true } | { ok: false; reason: 'not_connected' | 'invalid' }> {
  if (!/^properties\/[^/]+$/.test(property)) {
    return { ok: false, reason: 'invalid' }
  }

  const { data: conn } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('id')
    .eq('client_id', clientId)
    .eq('provider', 'google_ga4')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (!conn) return { ok: false, reason: 'not_connected' }

  await supabaseAdmin
    .from('platform_oauth_connections')
    .update({ account_id: property, updated_at: new Date().toISOString() })
    .eq('id', (conn as { id: string }).id)

  return { ok: true }
}
