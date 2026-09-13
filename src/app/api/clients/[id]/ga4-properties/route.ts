/**
 * GA4 property picker.
 *
 *   GET   → which property is bound today + the choices under this client's
 *           connected Google account (live from Google; nothing to store).
 *   PATCH → bind a specific property (verifies read access before saving as
 *           'connected' — see setGa4Property in @/lib/ga4/property).
 *
 * Mirrors /api/clients/[id]/gbp/locations/route.ts. No cross-client
 * exclusivity check here — see ga4/property.ts for why.
 *
 * 2026-08-18 rewrite (#1052 GA4 connector diagnosis): GET used to gate
 * `connected` purely on a `platform_oauth_connections.provider='google_ga4'`
 * row existing — a row the OAuth callback only writes when its Admin-API
 * auto-discovery call happens to succeed. That's narrower than what's
 * actually needed to read GA4 data: `resolveAccessToken()` (ga4/client.ts)
 * already falls back to the GSC-shared token for clients whose Admin-API
 * discovery failed or was never attempted (COMBINED_GOOGLE_SCOPES grants
 * analytics.readonly in the same consent as webmasters.readonly). GET now
 * uses that same resolver, so "can this client read GA4 at all" has exactly
 * one definition across the picker and the actual sync path. `current` now
 * reads from `client_connectors` (the table ga4/sync and the daily cron
 * actually read) instead of `platform_oauth_connections.account_id`, which
 * was never the authoritative source for "which property is selected".
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireOnboardingClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { listGa4Properties } from '@/lib/ga4/admin'
import { resolveAccessToken } from '@/lib/ga4/client'
import { normalizeGa4PropertyId, toGa4ResourceName } from '@/lib/ga4/property-id'
import { setGa4Property } from '@/lib/ga4/property'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireOnboardingClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data: connector, error: connectorError } = await supabaseAdmin
    .from('client_connectors')
    .select('status, config')
    .eq('client_id', clientId)
    .eq('anchor', 'ga4')
    .maybeSingle<{ status: string; config: Record<string, unknown> | null }>()

  if (connectorError) {
    return NextResponse.json({ error: 'GA4 connector state unavailable' }, { status: 503 })
  }

  const currentPropertyId = connector?.config?.property_id
  const normalizedCurrent = typeof currentPropertyId === 'string'
    ? normalizeGa4PropertyId(currentPropertyId)
    : { ok: false as const }
  const current = normalizedCurrent.ok ? toGa4ResourceName(normalizedCurrent.propertyId) : null

  const accessToken = await resolveAccessToken(clientId)
  if (!accessToken) {
    return NextResponse.json({
      connected: false,
      connector_status: connector?.status ?? null,
      current,
      options: [],
    })
  }

  const result = await listGa4Properties(accessToken)
  if (!result.ok) {
    return NextResponse.json({
      connected: true,
      connector_status: connector?.status ?? null,
      current,
      options: [],
      error: 'google_unavailable',
    })
  }

  return NextResponse.json({
    connected: true,
    connector_status: connector?.status ?? null,
    current,
    options: result.properties.map((p) => ({
      property: p.property,
      display_name: p.displayName,
    })),
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireOnboardingClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: { property?: unknown }
  try {
    body = (await req.json()) as { property?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.property !== 'string' || !body.property.trim()) {
    return NextResponse.json({ error: '`property` is required' }, { status: 400 })
  }

  const result = await setGa4Property(clientId, body.property.trim())

  if (!result.ok) {
    const message =
      result.reason === 'not_connected'
        ? '这个客户还没连上 Google 网站数据。'
        : result.reason === 'storage_error'
          ? 'Property 已完成验证，但连接状态暂时保存不了，请稍后重试。'
        : 'Property 编号格式不对，应该是纯数字或 properties/数字。'
    return NextResponse.json(
      { error: message, reason: result.reason },
      { status: result.reason === 'storage_error' ? 503 : 400 },
    )
  }

  try {
    revalidatePath(`/dashboard/clients/${clientId}/settings`)
  } catch {
    // best-effort during dev / non-Next runtime
  }

  if (result.status === 'error') {
    const message =
      result.reason === 'permission_denied'
        ? '没有切换 Property：这个 Google 账号对它没有权限，或者授权已经失效。'
        : result.reason === 'not_found'
          ? '没有切换 Property：编号对不上任何 GA4 资源，确认一下编号。'
          : '没有切换 Property：暂时联系不上 Google Analytics，请稍后重试。'
    return NextResponse.json({
      success: true,
      property: toGa4ResourceName(result.propertyId),
      status: 'error',
      reason: result.reason,
      message,
    })
  }

  return NextResponse.json({
    success: true,
    property: toGa4ResourceName(result.propertyId),
    status: 'connected',
  })
}
