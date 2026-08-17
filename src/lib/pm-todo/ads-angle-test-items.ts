/**
 * 广告角度测试的人工任务出口 —— SOP《Meta 广告角度测试与预算分配》§6b。
 *
 * 铁律 3 的下半句：确实做不了自动化的，**必须下发成人工任务，且进同一个管道**
 * （今日待办），不能只写进文档等人想起来翻。这份 SOP 合并时（PR #984）四类
 * 人工任务一条都没接进管道，文档里逐条标着「❌ 未接入」—— 这个模块接第一类。
 *
 * ── 为什么这一轮只接「问月预算」这一类 ─────────────────────────────────
 *
 * SOP 的四类任务是：月初算池 / 开跑前写判据 / 第 7 天核对 / 轮末落记录。
 * 后三类都需要系统知道「有一轮测试正在跑」，而**系统里没有「轮次」这个东西**
 * （`winner_structures` / `ad_creative_links` 至今 0 行，角度标签只存在于广告
 * 名字里）。建轮次表 = 建广告测量层 = 建设顺序第 1 步，而第 0 步还没开始。
 *
 * 所以这里只接第一类 —— 但它恰好是另外三类的前置：不知道月预算，探索池算不
 * 出来，臂数、判据、轮次全部无从谈起。剩下三类继续在 SOP §6b 里标「未接入」，
 * 等第 1 步。**不许为了「看起来接完了」而伪造一个假的轮次概念。**
 *
 * ── 为什么不顺手做「超预算提醒」 ───────────────────────────────────────
 *
 * 🔴 **刻意不做**，不是漏了。`ad_daily_insights` 至今**没有币种列**（`AD-CUR-1`
 *    已登记），而 CTS / Roman 是 NZD 账户、Oztop 是 AUD。拿一个不知道币种的
 *    花费去跟一个知道币种的预算比大小，正是 `AD-CUR-1` 要修的那个洞的新入口。
 *
 *    按 WP00 §3.3 的口径：对不上就产出 `not_comparable`，**不许降级成一个能比
 *    的数字**。等 `AD-CUR-1` 给花费表补上币种，这条才有资格做。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { toRealAmount } from '@/lib/ads-strategy/config'

export interface AdsAngleTestTodo {
  client_id: string
  what: string
  how: string
  href: string
}

/**
 * 每月拿多少比例去试没验证过的说法 —— **Product Owner 决议（2026-08-15）**。
 *
 * 这不是数据算出来的自然常数，是一条可复核的业务政策。改它要 PO 点头。
 * 口径见 SOP §0：这是**整月共享池**，逐轮扣减，不是每轮各拿 20%。
 */
export const EXPLORATION_BUDGET_SHARE = 0.2

/** 本月探索池 = 月预算 × 20%。纯函数，好测。 */
export function explorationPool(monthlyBudget: number): number {
  return monthlyBudget * EXPLORATION_BUDGET_SHARE
}

/** 该客户这个月在 Meta 上花掉的钱（账户币种，本表没有币种列）。 */
interface MonthSpend {
  clientId: string
  /** 已花金额；拿不到明细时为 null（只知道「在投」，不知道花了多少）。 */
  spend: number | null
}

/**
 * 本月有广告花费的客户。
 *
 * 🔴 **必须只按一个层级求和。** 同一笔花费在 `level` 上出现多次
 *    （实测 campaign 与 ad 两层各自加总都等于同一个数），把所有行加起来
 *    会得到两三倍的假金额。这里以 campaign 层为准；某客户只有 ad 层数据时
 *    退回 ad 层，避免整条待办因为层级缺失而静默消失。
 */
export async function loadMonthSpendByClient(
  supabase: SupabaseClient,
  now: Date,
): Promise<MonthSpend[]> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10)

  const { data, error } = await supabase
    .from('ad_daily_insights')
    .select('client_id, level, spend')
    .gte('insight_date', monthStart)
    .in('level', ['campaign', 'ad'])

  if (error) {
    console.warn('[ads-angle-test] 本月花费读取失败（不阻塞其他待办）:', error.message)
    return []
  }

  const byClient = new Map<string, { campaign: number; ad: number; any: boolean }>()
  for (const row of (data ?? []) as Array<{ client_id: string; level: string; spend: unknown }>) {
    const cur = byClient.get(row.client_id) ?? { campaign: 0, ad: 0, any: false }
    const amount = toRealAmount(row.spend) ?? 0
    if (row.level === 'campaign') cur.campaign += amount
    else cur.ad += amount
    cur.any = true
    byClient.set(row.client_id, cur)
  }

  const out: MonthSpend[] = []
  for (const [clientId, v] of Array.from(byClient.entries())) {
    if (!v.any) continue
    const spend = v.campaign > 0 ? v.campaign : v.ad > 0 ? v.ad : null
    // 有行但金额全是 0 —— 广告挂着没花钱，还没到需要预算的时候
    if (spend === null) continue
    out.push({ clientId, spend })
  }
  return out
}

/** 已填预算的客户集合（金额与币种成对才算填了 —— 与读侧口径一致）。 */
async function loadClientsWithBudget(
  supabase: SupabaseClient,
  clientIds: string[],
): Promise<Set<string>> {
  if (clientIds.length === 0) return new Set()
  const { data, error } = await supabase
    .from('ad_strategy_configs')
    .select('client_id, monthly_ad_budget, monthly_ad_budget_currency')
    .in('client_id', clientIds)

  if (error) {
    // 🔴 读不到时**不下发**，不是「当成没填全推一遍」。
    //    迁移还没 apply 的环境这里必然报错，那时候给每个客户推一条
    //    「没登记月预算」= 一条谁也没法处理的噪音。
    console.warn('[ads-angle-test] 广告预算配置读取失败（本轮不下发）:', error.message)
    return new Set(clientIds)
  }

  const filled = new Set<string>()
  for (const row of (data ?? []) as Array<{
    client_id: string
    monthly_ad_budget: unknown
    monthly_ad_budget_currency: unknown
  }>) {
    const amount = toRealAmount(row.monthly_ad_budget)
    const currency = row.monthly_ad_budget_currency
    if (amount !== null && typeof currency === 'string' && currency !== '') {
      filled.add(row.client_id)
    }
  }
  return filled
}

/** 金额印成人看的样子：两位小数 + 千分位，不带币种符号（本表没有币种列）。 */
export function formatSpend(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * 在投广告但没登记月预算 → 下发。
 *
 * 判据刻意用「本月真的花了钱」而不是「配了 Meta 账户」：没在投的客户不需要
 * 现在就定预算，为他们推一条只是噪音。
 */
export async function fetchAdsAngleTestTodos(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<AdsAngleTestTodo[]> {
  const spending = await loadMonthSpendByClient(supabase, now)
  if (spending.length === 0) return []

  const withBudget = await loadClientsWithBudget(
    supabase,
    spending.map((s) => s.clientId),
  )

  const todos: AdsAngleTestTodo[] = []
  for (const s of spending) {
    if (withBudget.has(s.clientId)) continue

    todos.push({
      client_id: s.clientId,
      what:
        `这个月广告已经花掉 ${formatSpend(s.spend!)}（账户币种），但系统里没登记他的月广告预算 —— ` +
        `按规矩每月要拿 ${Math.round(EXPLORATION_BUDGET_SHARE * 100)}% 出来试没验证过的说法，` +
        '这个数算不出来，这个月的角度测试就没法按规矩开。',
      how:
        '问客户或翻合同确认「这个月准备投多少广告」，填进设置页的「月广告预算」（链接直达，记得选对币种）。' +
        '⚠️ 别拿上面那个已花金额倒推 —— 那是花了多少，不是准备花多少，两者能差一倍。' +
        '填完这条自己消失。这个月确实不投广告就留空不填。',
      href: `https://app.magicengine.com.au/dashboard/clients/${s.clientId}/settings`,
    })
  }
  return todos
}
