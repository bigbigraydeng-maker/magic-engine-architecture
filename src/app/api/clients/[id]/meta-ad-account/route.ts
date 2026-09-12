/**
 * Meta ad account — single write entry for clients.meta_ad_account_id.
 *
 * GET   → returns the persisted ad account id (or null when unset).
 * PATCH → replaces it. Empty/null body clears the binding.
 *
 * Consumed by:
 *   - src/app/api/clients/[id]/meta-ads/sync/route.ts (manual sync, 422 if unset)
 *   - src/app/api/cron/google-data-pullback-daily/route.ts (daily flywheel)
 *   - src/lib/diagnostic/adapters/MetaAdsAdapter.ts
 *
 * BUG-FMT-S04 — closes the only "must open Supabase" gap in the ads pillar.
 * Mirrors src/app/api/clients/[id]/brand-aliases/route.ts.
 *
 * 2026-09-13: also mirrors the write into `client_meta_ad_accounts` (the new
 * multi-account table — see src/lib/meta/client-ad-accounts.ts) as the
 * `is_primary=true` row, so this stays the single place PM/FDE change the
 * primary account and the new table never drifts from it. This route still
 * only ever manages ONE account (the primary) — adding a UI to register a
 * SECOND account for a client is out of scope here; today that's a one-time
 * data seed in the migration (see 20260913000001_client_meta_ad_accounts.sql).
 * Clearing the primary (PATCH with null) only demotes any existing
 * `is_primary` row to false — it does not delete it, so an already-registered
 * secondary/former-primary account keeps being synced/swept.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

interface PatchBody {
  ad_account_id?: unknown
}

/**
 * Meta ad account IDs look like `act_2775766642787274` (real ones are 15-17 digits).
 * We normalise:
 *   - trim
 *   - lowercase the `act_` prefix (so `Act_…` / `ACT_…` are accepted)
 *   - reject anything that isn't `act_<10+ digits>`
 *   - auto-prepend `act_` when the user typed bare digits (FDE ergonomics)
 *
 * The 10-digit minimum guards against truncated/test IDs like `act_0` slipping
 * through and triggering opaque Meta Graph API errors at sync time. Real Meta
 * account IDs have never been < 10 digits in production; if Meta changes that,
 * relax this bound here (single source of truth).
 *
 * Returns null on empty input (clear binding).
 * Throws on malformed input so PATCH returns 400 with a clear message.
 */
function normaliseAdAccountId(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string') throw new Error('ad_account_id must be a string or null')

  const trimmed = raw.trim()
  if (trimmed.length === 0) return null

  // Allow bare digits (FDE convenience) — auto-prepend `act_`.
  const candidate = /^\d+$/.test(trimmed) ? `act_${trimmed}` : trimmed.toLowerCase()

  if (!/^act_\d{10,}$/.test(candidate)) {
    throw new Error('ad_account_id must look like `act_<digits>` with at least 10 digits (e.g. act_2775766642787274)')
  }
  return candidate
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('meta_ad_account_id')
    .eq('id', clientId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const raw = (data as { meta_ad_account_id: unknown }).meta_ad_account_id
  const ad_account_id = typeof raw === 'string' && raw.trim().length > 0 ? raw : null

  return NextResponse.json({ ad_account_id })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  let next: string | null
  try {
    next = normaliseAdAccountId(body.ad_account_id)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }

  const { error: updateErr } = await supabaseAdmin
    .from('clients')
    .update({ meta_ad_account_id: next })
    .eq('id', clientId)

  if (updateErr) {
    return NextResponse.json(
      { error: `Failed to update meta_ad_account_id: ${updateErr.message}` },
      { status: 500 },
    )
  }

  // Mirror into client_meta_ad_accounts so multi-account readers
  // (getClientAdAccounts) never see a stale/absent primary row.
  // Best-effort: this table is a read-side convenience for sync/readback, the
  // `clients` column above is still the authoritative write — a failure here
  // must not turn a successful primary-account update into a 500.
  const { error: demoteErr } = await supabaseAdmin
    .from('client_meta_ad_accounts')
    .update({ is_primary: false })
    .eq('client_id', clientId)
    .eq('is_primary', true)
  if (demoteErr) {
    console.error('[meta-ad-account] failed to demote old primary row:', demoteErr.message)
  }
  if (next) {
    const { error: upsertErr } = await supabaseAdmin
      .from('client_meta_ad_accounts')
      .upsert(
        { client_id: clientId, ad_account_id: next, is_primary: true, label: '主账户' },
        { onConflict: 'client_id,ad_account_id' },
      )
    if (upsertErr) {
      console.error('[meta-ad-account] failed to upsert primary row:', upsertErr.message)
    }
  }

  try {
    revalidatePath(`/dashboard/clients/${clientId}/settings`)
  } catch {
    // best-effort during dev / non-Next runtime
  }

  return NextResponse.json({
    success: true,
    ad_account_id: next,
  })
}
