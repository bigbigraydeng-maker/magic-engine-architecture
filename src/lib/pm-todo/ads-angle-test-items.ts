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
import { businessMonthStart, isInBusinessMonth } from '@/lib/ads-strategy/business-month'
import { fetchAll } from '@/lib/supabase-paginate'

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

// 业务月份判据是**一份**，服务端与设置页共用，见 ads-strategy/business-month.ts
export { businessMonth, businessMonthStart } from '@/lib/ads-strategy/business-month'

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
  /**
   * 只看这些客户（`loadManualItems` 手上的活跃客户）。
   *
   * 🔴 不限定的话，本月花过钱、之后被停用的客户仍会出待办，而 `nameOf` 只能把
   *    他显示成「未知客户」—— 于是每天的待办邮件都在催人处理一个已经停掉的客户。
   */
  activeClientIds: string[],
): Promise<MonthSpend[]> {
  if (activeClientIds.length === 0) return []
  const monthStart = businessMonthStart(now)

  /**
   * 🔴 必须分页读全。PostgREST 单次查询**硬顶 1000 行且不报错**
   *    （`supabase-paginate.ts` 记着 2026-07-29 静默丢 271 条触点那次事故）。
   *
   *    这里被截断的后果特别隐蔽：分组是在截断**之后**做的，所以排在后面的客户
   *    可能整个不出现在结果里 —— 他就永远收不到预算待办，而系统看起来一切正常。
   *    这正是本功能要修的那类「发现死在暗处」的毛病，不能自己再造一个。
   *
   *    ad 级明细一个月轻易上千行（`daily-insights.ts` 自己写过一次 30 天回填
   *    就可能有数千行），所以这不是理论风险。
   */
  let data: Array<{ client_id: string; level: string; spend: unknown }>
  try {
    data = await fetchAll<{ client_id: string; level: string; spend: unknown }>((from, to) =>
      supabase
        .from('ad_daily_insights')
        .select('client_id, level, spend')
        .gte('insight_date', monthStart)
        .in('client_id', activeClientIds)
        .in('level', ['campaign', 'ad'])
        // range 必须配稳定排序，否则分页之间会重复或漏行
        .order('id', { ascending: true })
        .range(from, to),
    )
  } catch (e) {
    console.warn(
      '[ads-angle-test] 本月花费读取失败（不阻塞其他待办）:',
      e instanceof Error ? e.message : e,
    )
    return []
  }

  const byClient = new Map<string, { campaign: number; ad: number; any: boolean }>()
  for (const row of data) {
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

/**
 * 一个客户的月预算在**本业务月**的状态。
 *
 * 🔴 `stale` 是独立的一档，不能并进 `filled`：预算是**按月**确认的业务事实
 *    （SOP §0「月初按真实月预算算出这个月的探索池」）。8 月填过的数字，
 *    9 月不会自动还成立 —— 客户完全可能这个月加码或者停投。
 *    当成 `filled` 的话，9 月的待办永远不出现，FDE 也就永远不会去确认，
 *    而系统会拿着上个月的池子继续算 —— 一个没人复核过的花钱额度。
 */
/**
 * 🔴 `declined` 也必须是独立的一档。
 *
 *    待办和设置页都告诉 FDE「这个月确实不投广告就留空」，但**留空之后如果跟
 *    「压根没问过」长得一模一样**，第二天这条待办照旧冒出来 —— 一直催到月底。
 *    那就是给了一个「做了也没用」的指示，比不给指示更糟。
 *
 *    判据不用新加列：清空时接口会写 `monthly_ad_budget_updated_at`，
 *    所以「金额为空 + 时间戳落在本业务月」= 这个月有人明确清过 = 已确认不投；
 *    「金额为空 + 时间戳缺失或是上个月的」= 从没问过 / 上个月的决定不算数。
 */
export type BudgetStatus = 'filled' | 'stale' | 'missing' | 'declined'

export interface BudgetState {
  status: BudgetStatus
  /** `stale` 时带上上次填的值，好在待办里说清「上次填的是多少」。 */
  amount: number | null
  currency: string | null
  updatedAt: string | null
}

export async function loadBudgetStateByClient(
  supabase: SupabaseClient,
  clientIds: string[],
  now: Date,
): Promise<Map<string, BudgetState> | null> {
  if (clientIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('ad_strategy_configs')
    .select('client_id, monthly_ad_budget, monthly_ad_budget_currency, monthly_ad_budget_updated_at')
    .in('client_id', clientIds)

  if (error) {
    // 🔴 读不到时**整轮不下发**（返回 null），不是「当成没填全推一遍」。
    //    迁移还没 apply 的环境这里必然报错，那时候给每个客户推一条
    //    「没登记月预算」= 一条谁也没法处理的噪音。
    console.warn('[ads-angle-test] 广告预算配置读取失败（本轮不下发）:', error.message)
    return null
  }

  const out = new Map<string, BudgetState>()
  for (const row of (data ?? []) as Array<{
    client_id: string
    monthly_ad_budget: unknown
    monthly_ad_budget_currency: unknown
    monthly_ad_budget_updated_at: unknown
  }>) {
    const amount = toRealAmount(row.monthly_ad_budget)
    const currency =
      typeof row.monthly_ad_budget_currency === 'string' && row.monthly_ad_budget_currency !== ''
        ? row.monthly_ad_budget_currency
        : null
    const updatedAt =
      typeof row.monthly_ad_budget_updated_at === 'string' ? row.monthly_ad_budget_updated_at : null

    const touchedThisMonth = isInBusinessMonth(updatedAt, now)

    /**
     * 🔴 「干净地清空」才算确认不投 —— 金额和币种**都**是空。
     *
     *    不能用「金额算不出有效值」当判据：填了 0、填了负数、只填了币种没填
     *    金额，这些都是**填错**，不是「确认不投」。当成 declined 的话，
     *    一个手滑填 0 的客户会被永久标成「本月不投」，再也没人去问 ——
     *    而他其实正在花钱。方向必须反过来：拿不准就继续催。
     */
    const cleanlyCleared =
      (row.monthly_ad_budget === null || row.monthly_ad_budget === undefined) && currency === null

    // 成对才算填过（与 config.ts 读侧口径一致）
    if (amount === null || currency === null) {
      out.set(row.client_id, {
        status: cleanlyCleared && touchedThisMonth ? 'declined' : 'missing',
        amount: null,
        currency: null,
        updatedAt,
      })
      continue
    }

    // 填过，但是不是**这个月**填的？时间戳解析不出来时按 stale 处理 ——
    // 方向安全：多问一次，好过拿一个说不清是哪个月的数字去算花钱额度。
    out.set(row.client_id, {
      status: touchedThisMonth ? 'filled' : 'stale',
      amount,
      currency,
      updatedAt,
    })
  }
  return out
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
  activeClientIds: string[] = [],
): Promise<AdsAngleTestTodo[]> {
  const spending = await loadMonthSpendByClient(supabase, now, activeClientIds)
  if (spending.length === 0) return []

  const states = await loadBudgetStateByClient(
    supabase,
    spending.map((s) => s.clientId),
    now,
  )
  // 配置读不到 → 整轮不下发（详见 loadBudgetStateByClient）
  if (states === null) return []

  const pct = Math.round(EXPLORATION_BUDGET_SHARE * 100)
  const todos: AdsAngleTestTodo[] = []

  for (const s of spending) {
    const state = states.get(s.clientId) ?? {
      status: 'missing' as const,
      amount: null,
      currency: null,
      updatedAt: null,
    }
    // filled = 这个月填了预算；declined = 这个月明确说了不投。两者都不用再催。
    if (state.status === 'filled' || state.status === 'declined') continue

    /**
     * 🔴 金额只敢说到「账户口径」，不敢说成「这个客户花的」。
     *
     *    `syncCampaignDailyInsights` 把整个广告账户拉回来的每一行都盖上传入的
     *    `clientId`（`daily-insights.ts` 的 `rows.map(... clientId ...)`），
     *    而 `act_2775766642787274` 是记录在案的混账户（CTS 旅游帖 + Oztop
     *    flooring 帖混跑）。所以这一列**证明不了 campaign 归属**。
     *
     *    审计 §3.1 正因为同一个原因撤回过「26 组都是 CTS 的」那句话，SOP §9
     *    也刚为此更正过 —— 这里不重犯第三次。要按客户说准，得先做 `AD-EVID-1`
     *    的 campaign→client 归属；那不在本条待办的范围内。
     *
     *    对这条待办来说影响可控：金额只是「真的有钱在动」的佐证，
     *    而要做的事（去问这个客户的月预算）不依赖那个数精确到分。
     */
    const spendLine = `账上记到 ${formatSpend(s.spend!)}（账户口径，混账户下可能含别家 campaign）`

    if (state.status === 'stale') {
      const last = `${state.currency} ${state.amount!.toLocaleString('en-US')}`
      const when = state.updatedAt ? state.updatedAt.slice(0, 10) : '更早以前'
      todos.push({
        client_id: s.clientId,
        what:
          `这个月已经有广告在花钱（${spendLine}），但月广告预算还是 ${when} 填的 ${last} —— ` +
          '预算是按月确认的，上个月的数字不能直接拿来算这个月的探索池。',
        how:
          `跟客户确认这个月还是不是 ${last}：是就打开设置页把它重新保存一次（时间戳更新，这条就消失）；` +
          '变了就改成新的数；这个月不投广告就把它清空。',
        href: `https://app.magicengine.com.au/dashboard/clients/${s.clientId}/settings`,
      })
      continue
    }

    todos.push({
      client_id: s.clientId,
      what:
        `这个月已经有广告在花钱（${spendLine}），但系统里没登记他的月广告预算 —— ` +
        `按规矩每月要拿 ${pct}% 出来试没验证过的说法，这个数算不出来，` +
        '这个月的角度测试就没法按规矩开。',
      how:
        '问客户或翻合同确认「这个月准备投多少广告」，填进设置页的「月广告预算」（链接直达，记得选对币种）。' +
        '⚠️ 别拿上面那个已花金额倒推 —— 那是花了多少，不是准备花多少，两者能差一倍。' +
        '填完这条自己消失。这个月确实不投广告就留空不填。',
      href: `https://app.magicengine.com.au/dashboard/clients/${s.clientId}/settings`,
    })
  }
  return todos
}
