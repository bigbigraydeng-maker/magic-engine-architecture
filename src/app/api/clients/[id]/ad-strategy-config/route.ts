/**
 * GET/PATCH /api/clients/[id]/ad-strategy-config
 *
 * Reads and updates a client's Ad Strategy Engine control settings (on/off,
 * digest recipients, monthly ad budget). Backs the Settings panel (P21.K.5).
 * Config edits go through this route — never raw SQL — per the FDE-config red-line.
 *
 * 🔴 判定逻辑一律放在 `@/lib/ads-strategy/config` 的纯函数里（`buildConfigUpdate`），
 *    路由层只做鉴权 + 取数 + 回话。原因见 `buildConfigUpdate` 的注释：这个路由
 *    没有测试，判定住在这里就等于没被任何东西锁住。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import {
  buildConfigUpdate,
  currencyForCountry,
  emptyBudgetFields,
  loadAdBudgetFields,
  loadAdStrategyConfig,
} from '@/lib/ads-strategy/config'
import { businessMonth, timeZoneForCountry } from '@/lib/ads-strategy/business-month'

export const dynamic = 'force-dynamic'

/** 客户所在国 —— 决定币种建议与「现在算哪个业务月」。读不到就当 null。 */
async function loadCountry(clientId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('clients')
    .select('country')
    .eq('id', clientId)
    .maybeSingle<{ country: string | null }>()
  return data?.country ?? null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const [config, budget, country] = await Promise.all([
    loadAdStrategyConfig(clientId),
    loadAdBudgetFields(clientId),
    loadCountry(clientId),
  ])

  return NextResponse.json({
    success: true,
    config: { ...config, ...(budget ?? emptyBudgetFields()) },
    /**
     * 🔴 币种建议按客户所在国给，**不给全局默认值**。
     *
     *    设置页不能自己写死一个默认币种：迁移之后所有客户都还没存过币种，
     *    写死 NZD 会让 AU 客户（Oztop）的预算被默默存成纽币。
     *    国家判断不出来时返回 null，界面据此强制人选一次。
     */
    suggested_currency: currencyForCountry(country),
    /**
     * 现在算哪个业务月（按这个客户所在国的时区）。
     * 🔴 界面拿它跟 `monthly_ad_budget_month` 做**字符串比对**判断「是不是本月填的」——
     *    浏览器端不再自己算月份，两边各算一份必然分家。
     */
    current_business_month: businessMonth(new Date(), timeZoneForCountry(country)),
    /**
     * 预算这几列读到了没有。`false` = 没查到（多半是 migration 还没 apply），
     * **不是「都没填」** —— 界面据此说实话，而不是显示一个假的「还没填」。
     */
    budget_available: budget !== null,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const country = await loadCountry(clientId)
  const built = buildConfigUpdate({
    clientId,
    body,
    actorEmail: access.user.email ?? null,
    country,
    now: new Date(),
  })
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('ad_strategy_configs')
    .upsert(built.update, { onConflict: 'client_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const [config, budget] = await Promise.all([
    loadAdStrategyConfig(clientId),
    loadAdBudgetFields(clientId),
  ])
  return NextResponse.json({
    success: true,
    config: { ...config, ...(budget ?? emptyBudgetFields()) },
    current_business_month: businessMonth(new Date(), timeZoneForCountry(country)),
    budget_available: budget !== null,
  })
}
