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
  AD_BUDGET_CURRENCIES,
  currencyForCountry,
  isAdBudgetCurrency,
  loadAdStrategyConfig,
  toRealAmount,
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
   * 月广告预算 —— 金额和币种**必须一起传**。
   *
   * 🔴 只传金额不传币种是 `AD-CUR-1` 那个洞的新入口（库里存了个数字，没人知道
   *    是 AUD 还是 NZD，下一步就是跨客户混币种加总）。数据库有 paired 约束，
   *    但接口层要先把话说清楚，别让 FDE 收到一句看不懂的约束报错。
   *
   * 🔴 清空用「两个都传 null」，不是传 0 —— 0 会被库里的 `> 0` 约束拒掉。
   *    「这个月不投广告」的表达方式是清空，不是填 0。
   */
  const budgetTouched =
    body.monthly_ad_budget !== undefined || body.monthly_ad_budget_currency !== undefined
  if (budgetTouched) {
    const rawAmount = body.monthly_ad_budget ?? null
    const rawCurrency = body.monthly_ad_budget_currency ?? null

    if (rawAmount === null && rawCurrency === null) {
      update.monthly_ad_budget = null
      update.monthly_ad_budget_currency = null
      update.monthly_ad_budget_updated_at = new Date().toISOString()
      update.monthly_ad_budget_updated_by = access.user.email ?? null
    } else if (rawAmount === null || rawCurrency === null) {
      return NextResponse.json(
        { error: '月预算的金额和币种必须一起填；要清空就两个都留空' },
        { status: 400 },
      )
    } else {
      // 🔴 先卡类型再谈数值。不卡的话 `true` / `[2000]` 这类 JSON 会被
      //    `Number()` 悄悄转成 1 / 2000 写进库 —— 存进去的不是任何人填过的数字，
      //    而库里的 `> 0` 约束对这种「转换出来的合法值」完全无感。
      if (typeof rawAmount !== 'number' && typeof rawAmount !== 'string') {
        return NextResponse.json(
          { error: '月预算必须是数字（收到的是 ' + typeof rawAmount + '）' },
          { status: 400 },
        )
      }
      const amount = toRealAmount(rawAmount)
      if (amount === null) {
        return NextResponse.json(
          { error: '月预算必须是一个大于 0 的金额（不收 0、负数、NaN、无穷大）' },
          { status: 400 },
        )
      }
      if (!isAdBudgetCurrency(rawCurrency)) {
        return NextResponse.json(
          { error: `币种只支持 ${AD_BUDGET_CURRENCIES.join(' / ')}` },
          { status: 400 },
        )
      }
      update.monthly_ad_budget = amount
      update.monthly_ad_budget_currency = rawCurrency
      update.monthly_ad_budget_updated_at = new Date().toISOString()
      update.monthly_ad_budget_updated_by = access.user.email ?? null
    }
  }

  const { error } = await supabaseAdmin
    .from('ad_strategy_configs')
    .upsert(update, { onConflict: 'client_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const config = await loadAdStrategyConfig(clientId)
  return NextResponse.json({ success: true, config })
}
