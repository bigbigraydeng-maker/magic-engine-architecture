/**
 * GET/PATCH /api/clients/[id]/ad-strategy-config
 *
 * Reads and updates a client's Ad Strategy Engine control settings (on/off,
 * digest recipients). Backs the Settings panel (P21.K.5). Config edits go
 * through this route — never raw SQL — per the FDE-config red-line.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import {
  currencyForCountry,
  loadAdStrategyConfig,
  parseBudgetPatch,
} from '@/lib/ads-strategy/config'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const config = await loadAdStrategyConfig(clientId)
  /**
   * 🔴 币种建议按客户所在国给，**不给全局默认值**。
   *
   *    设置页不能自己写死一个默认币种：迁移之后所有客户都还没存过币种，
   *    写死 NZD 会让 AU 客户（Oztop）的预算被默默存成纽币。
   *    国家判断不出来时返回 null，界面据此强制人选一次。
   */
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('country')
    .eq('id', clientId)
    .maybeSingle<{ country: string | null }>()

  return NextResponse.json({
    success: true,
    config,
    suggested_currency: currencyForCountry(client?.country),
  })
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: {
    enabled?: unknown
    digest_recipients?: unknown
    monthly_ad_budget?: unknown
    monthly_ad_budget_currency?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const update: Record<string, unknown> = { client_id: clientId, updated_at: new Date().toISOString() }

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
    }
    update.enabled = body.enabled
  }

  if (body.digest_recipients !== undefined) {
    if (!Array.isArray(body.digest_recipients) || body.digest_recipients.some(e => typeof e !== 'string')) {
      return NextResponse.json({ error: 'digest_recipients must be an array of strings' }, { status: 400 })
    }
    const emails = (body.digest_recipients as string[]).map(e => e.trim()).filter(Boolean)
    const bad = emails.find(e => !EMAIL_RE.test(e))
    if (bad) return NextResponse.json({ error: `Invalid email: ${bad}` }, { status: 400 })
    update.digest_recipients = emails
  }

  /**
   * 月广告预算 —— 判据与文案都在 `parseBudgetPatch`（纯函数，可直接测）。
   *
   * 🔴 金额和币种**必须一起传，清空也不例外**：只传一个会让另一个被当成 null，
   *    从而把一次部分更新变成「删掉预算 + 标记本月确认不投」，整月不再提醒。
   */
  const patch = parseBudgetPatch(body as Record<string, unknown>)
  if (!patch.ok) return NextResponse.json({ error: patch.error }, { status: 400 })
  if (patch.kind !== 'untouched') {
    update.monthly_ad_budget = patch.kind === 'clear' ? null : patch.amount
    update.monthly_ad_budget_currency = patch.kind === 'clear' ? null : patch.currency
    update.monthly_ad_budget_updated_at = new Date().toISOString()
    update.monthly_ad_budget_updated_by = access.user.email ?? null
  }

  const { error } = await supabaseAdmin
    .from('ad_strategy_configs')
    .upsert(update, { onConflict: 'client_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const config = await loadAdStrategyConfig(clientId)
  return NextResponse.json({ success: true, config })
}
