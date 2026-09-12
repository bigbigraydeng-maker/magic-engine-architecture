/**
 * Client ↔ Meta ad account lookup — the multi-account read path.
 *
 * `clients.meta_ad_account_id` is a single-value column and stays that way:
 * it remains the "primary account" used by every single-account call site
 * (boost-post, draft-listing, draft, comment-autoreply, campaign-ownership's
 * fallback, the settings write route). This module is only for the two kinds
 * of callers that must see EVERY account a client runs: the daily sync cron
 * and the daily safety/readback sweep.
 *
 * Backed by `client_meta_ad_accounts` (2026-09-13, CTS multi-account gap fix:
 * CTS runs a second Meta ad account — act_2202695063810470, "CTStours 官方
 * 账户" — that `meta_ad_account_id` never captured, so its ThruPlay spend was
 * invisible to reporting and health checks).
 */

import { supabaseAdmin } from '@/lib/supabase'

export interface ClientAdAccount {
  adAccountId: string
  label: string | null
  isPrimary: boolean
}

/**
 * All Meta ad accounts registered for a client, primary first.
 *
 * Falls back to `clients.meta_ad_account_id` when the client has zero rows in
 * `client_meta_ad_accounts` — covers any client onboarded before this table
 * existed, or a future write to `meta_ad_account_id` that hasn't been mirrored
 * into the new table yet. Callers should not need to know which source fired.
 */
export async function getClientAdAccounts(clientId: string): Promise<ClientAdAccount[]> {
  const { data, error } = await supabaseAdmin
    .from('client_meta_ad_accounts')
    .select('ad_account_id, label, is_primary')
    .eq('client_id', clientId)
    .order('is_primary', { ascending: false })

  if (error) {
    console.error('[meta/client-ad-accounts] query failed:', error.message)
  } else if (data && data.length > 0) {
    return (data as Array<{ ad_account_id: string; label: string | null; is_primary: boolean }>).map(row => ({
      adAccountId: row.ad_account_id,
      label: row.label,
      isPrimary: row.is_primary,
    }))
  }

  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('meta_ad_account_id')
    .eq('id', clientId)
    .maybeSingle()

  if (clientError) {
    console.error('[meta/client-ad-accounts] fallback query failed:', clientError.message)
    return []
  }
  const primary = (client as { meta_ad_account_id?: string | null } | null)?.meta_ad_account_id
  return primary ? [{ adAccountId: primary, label: '主账户', isPrimary: true }] : []
}

/** Just the account id strings, primary first. Convenience for sync loops. */
export async function getClientAdAccountIds(clientId: string): Promise<string[]> {
  return (await getClientAdAccounts(clientId)).map(a => a.adAccountId)
}
