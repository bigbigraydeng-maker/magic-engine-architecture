/**
 * Google Ads customer ID — single write entry for clients.google_ads_customer_id.
 *
 * GET   → resolves via src/lib/google-ads/creds-loader.ts#resolveCustomerId
 *         (returns both the value AND where it came from — clients table /
 *         OAuth connection / legacy flywheel payload — so the settings UI
 *         can tell FDE "this is coming from X", not just show a bare number).
 * PATCH → sets clients.google_ads_customer_id directly. Empty/null clears it.
 *
 * PR5 (docs/specs/2026-08-11-onboarding-integrations-unify-v1.md §2.3):
 * the old GoogleAdsPanel showed a fake "connect via OAuth" flow that could
 * never succeed (nothing writes provider=google_ads). Real ad execution
 * uses one shared MCC credential for all clients, distinguished only by
 * customer_id — this route is the "must not require Supabase Studio" write
 * path CLAUDE.md requires for any FDE-set field (same pattern as
 * meta-ad-account/route.ts).
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { resolveCustomerId } from '@/lib/google-ads/creds-loader'

interface PatchBody {
  customer_id?: unknown
}

/**
 * Google Ads customer IDs are 10 digits, sometimes displayed with dashes
 * (123-456-7890). Normalise to bare digits — the API rejects dashed form.
 * Returns null on empty input (clear binding).
 */
function normaliseCustomerId(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string') throw new Error('customer_id must be a string or null')

  const digitsOnly = raw.replace(/[\s-]/g, '')
  if (digitsOnly.length === 0) return null

  if (!/^\d{10}$/.test(digitsOnly)) {
    throw new Error('customer_id must be 10 digits (e.g. 1234567890 or 123-456-7890)')
  }
  return digitsOnly
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

  const result = await resolveCustomerId(supabaseAdmin, clientId)
  return NextResponse.json(result)
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
    next = normaliseCustomerId(body.customer_id)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }

  const { error: updateErr } = await supabaseAdmin
    .from('clients')
    .update({ google_ads_customer_id: next })
    .eq('id', clientId)

  if (updateErr) {
    return NextResponse.json(
      { error: `Failed to update google_ads_customer_id: ${updateErr.message}` },
      { status: 500 },
    )
  }

  try {
    revalidatePath(`/dashboard/clients/${clientId}/settings`)
  } catch {
    // best-effort during dev / non-Next runtime
  }

  return NextResponse.json({ success: true, customer_id: next })
}
