/**
 * Bind a specific GA4 property to a client (Settings picker write path).
 *
 * Mirrors gbp/location.ts's setGbpLocation, minus the cross-client
 * exclusivity check — a GA4 property visible to more than one ME client is
 * a normal business-structure fact (e.g. shared agency access), not a
 * data-integrity risk the way two clients posting to one GBP storefront
 * would be. See docs/specs/2026-08-11-onboarding-integrations-unify-v1.md §2.4.
 *
 * 2026-08-18 rewrite (#1052 GA4 connector diagnosis): this used to (a) demand
 * a `properties/…`-prefixed input — rejecting the bare-digit format the
 * historical CTS/Oztop connectors actually store — and (b) gate purely on a
 * `platform_oauth_connections.provider='google_ga4'` row existing, which the
 * OAuth callback's Admin-API auto-discovery step only writes when it
 * succeeds. Neither requirement reflects what's actually needed to read GA4
 * data: `ga4/client.ts`'s `resolveAccessToken()` already falls back to the
 * GSC-shared token (COMBINED_GOOGLE_SCOPES grants analytics.readonly in the
 * same consent as webmasters.readonly), so a client with a working GSC
 * connection can read GA4 without a GA4-specific token row. This function
 * now trusts that same fallback — via `verifyGa4PropertyAccess()` — instead
 * of re-implementing a narrower, inconsistent definition of "connected".
 */

import { supabaseAdmin } from '@/lib/supabase'
import { normalizeGa4PropertyId } from './property-id'
import { verifyGa4PropertyAccess, type Ga4VerifyFailureReason } from './client'

export type SetGa4PropertyResult =
  | { ok: true; status: 'connected'; propertyId: string }
  | { ok: true; status: 'error'; propertyId: string; reason: Ga4VerifyFailureReason; detail: string }
  | { ok: false; reason: 'invalid' | 'not_connected' }

export async function setGa4Property(
  clientId: string,
  property: string,
): Promise<SetGa4PropertyResult> {
  const normalized = normalizeGa4PropertyId(property)
  if (!normalized.ok) return { ok: false, reason: 'invalid' }
  const { propertyId } = normalized

  // Minimal read-only probe against the actual GA4 Data API — this is the
  // single source of truth for "does this client's Google token, whichever
  // one it resolves to, actually have access to this property?" (§2.6: a
  // real empty traffic result is `ok: true`, only a genuine API failure is
  // `ok: false` — see verifyGa4PropertyAccess's own doc comment).
  const verified = await verifyGa4PropertyAccess(clientId, propertyId)

  if (!verified.ok && verified.reason === 'no_token') {
    // Nothing to attach the property to — no Google grant of any kind
    // (GA4-specific or GSC-shared) exists for this client yet.
    return { ok: false, reason: 'not_connected' }
  }

  const now = new Date().toISOString()

  if (verified.ok) {
    const { error: upsertErr } = await supabaseAdmin
      .from('client_connectors')
      .upsert(
        {
          client_id:    clientId,
          anchor:       'ga4',
          status:       'connected',
          config:       { property_id: propertyId },
          connected_at: now,
          updated_at:   now,
        },
        { onConflict: 'client_id,anchor' },
      )
    if (upsertErr) {
      console.error('[ga4/property] failed to write client_connectors:', upsertErr.message)
      return { ok: false, reason: 'not_connected' }
    }
    return { ok: true, status: 'connected', propertyId }
  }

  // Verification ran and failed for a reason other than "no token at all"
  // (bad permission, property doesn't exist, or a genuine API error). Still
  // record the attempt — so the settings page can show *what* was tried and
  // *why* it didn't work, instead of silently discarding the input — but
  // mark it 'error' so ga4/sync's `status === 'connected'` gate keeps
  // rejecting it (see Phase B point 8: sync must stay disabled here).
  const { error: upsertErr } = await supabaseAdmin
    .from('client_connectors')
    .upsert(
      {
        client_id:    clientId,
        anchor:       'ga4',
        status:       'error',
        config:       { property_id: propertyId, error_reason: verified.reason, error_detail: verified.detail },
        connected_at: now,
        updated_at:   now,
      },
      { onConflict: 'client_id,anchor' },
    )
  if (upsertErr) {
    console.error('[ga4/property] failed to write client_connectors (error state):', upsertErr.message)
  }
  return { ok: true, status: 'error', propertyId, reason: verified.reason, detail: verified.detail }
}
