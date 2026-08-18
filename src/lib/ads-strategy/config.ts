/**
 * P21.K.5 — Ad Strategy Engine per-client configuration.
 *
 * Loads a client's control settings (on/off, digest routing), falling back to
 * safe defaults when no row exists so the engine works for a client the moment
 * they have a Meta account — no config step required to start.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { ME_MAIL_TO_ADDRESS } from '@/lib/email/sender'
import { businessMonth, isBusinessMonth, timeZoneForCountry } from './business-month'

/** 目标市场 AU/NZ —— 账户币种实读只有这两个（`AD-CUR-1`）。 */
export type AdBudgetCurrency = 'AUD' | 'NZD'

export const AD_BUDGET_CURRENCIES: readonly AdBudgetCurrency[] = ['AUD', 'NZD']

export function isAdBudgetCurrency(v: unknown): v is AdBudgetCurrency {
  return typeof v === 'string' && (AD_BUDGET_CURRENCIES as readonly string[]).includes(v)
}

/** 月预算补丁的解析结果：要么给出该写入的列，要么给出一句说人话的拒绝理由。 */
export type BudgetPatch =
  | { ok: true; kind: 'clear'; amount: null; currency: null }
  | { ok: true; kind: 'set'; amount: number; currency: AdBudgetCurrency }
  | { ok: false; error: string }
  /** 请求里压根没提预算 —— 不是错误，只是这次不动它。 */
  | { ok: true; kind: 'untouched' }

/**
 * 解析 PATCH 请求里的月预算部分。
 *
 * 🔴 **金额和币种必须一起出现，「清空」也不例外。**
 *
 *    早先用 `body.monthly_ad_budget ?? null` 取值，于是「字段没传」和「显式传了
 *    null」变成同一件事：调用方只传 `{ monthly_ad_budget: null }`（没提币种）时，
 *    币种也被当成 null → 判成「完整清空」→ **把已填的预算删掉，还顺手把这个客户
 *    标成「本月确认不投」，整个月不再提醒**。一次部分更新造成两处损失，
 *    而接口注释里写的本来是「这种情况返回 400」。
 *
 *    所以判据改成「这个键在不在请求体里」（`in`），不是「取出来是不是 null」。
 */
export function parseBudgetPatch(body: Record<string, unknown>): BudgetPatch {
  const hasAmount = Object.prototype.hasOwnProperty.call(body, 'monthly_ad_budget')
  const hasCurrency = Object.prototype.hasOwnProperty.call(body, 'monthly_ad_budget_currency')

  if (!hasAmount && !hasCurrency) return { ok: true, kind: 'untouched' }
  if (!hasAmount || !hasCurrency) {
    return {
      ok: false,
      error: '月预算的金额和币种必须一起传；要清空就两个都显式传 null',
    }
  }

  const rawAmount = body.monthly_ad_budget
  const rawCurrency = body.monthly_ad_budget_currency

  if (rawAmount === null && rawCurrency === null) {
    return { ok: true, kind: 'clear', amount: null, currency: null }
  }
  if (rawAmount === null || rawCurrency === null) {
    return {
      ok: false,
      error: '月预算的金额和币种必须一起填；要清空就两个都留空',
    }
  }

  // 🔴 先卡类型再谈数值：`Number(true) === 1`、`Number([2000]) === 2000`，
  //    不卡的话一个坏掉的调用方能写进「预算 1 元」，而库里的 `> 0` 约束
  //    对这种转换出来的合法值完全无感。
  if (typeof rawAmount !== 'number' && typeof rawAmount !== 'string') {
    return { ok: false, error: `月预算必须是数字（收到的是 ${typeof rawAmount}）` }
  }
  const amount = toRealAmount(rawAmount)
  if (amount === null) {
    return { ok: false, error: '月预算必须是一个大于 0 的金额（不收 0、负数、NaN、无穷大）' }
  }
  if (!isAdBudgetCurrency(rawCurrency)) {
    return { ok: false, error: `币种只支持 ${AD_BUDGET_CURRENCIES.join(' / ')}` }
  }
  return { ok: true, kind: 'set', amount, currency: rawCurrency }
}

/**
 * 按客户所在国推荐预算币种。**拿不准就返回 null，不猜。**
 *
 * 🔴 为什么不能给一个「默认币种」兜底：设置页第一版把下拉框写死默认 NZD，
 *    而迁移之后**所有客户都还没存过币种**。于是给 Oztop（AU）填预算时，
 *    只要没特意去点那个下拉框，**澳币的钱会被存成纽币** —— 探索池跟着算错，
 *    正是 `AD-CUR-1` 那类混币种问题的新入口。
 *
 *    所以这里只在**真的知道**的时候给建议；不知道就返回 null，让界面强制人选一次。
 *    宁可多点一下，也不要默默存一个错的币种。
 */
export function currencyForCountry(country: unknown): AdBudgetCurrency | null {
  if (typeof country !== 'string') return null
  switch (country.trim().toUpperCase()) {
    case 'AU':
    case 'AUS':
    case 'AUSTRALIA':
      return 'AUD'
    case 'NZ':
    case 'NZL':
    case 'NEW ZEALAND':
      return 'NZD'
    default:
      return null
  }
}

export interface AdStrategyConfig {
  client_id: string
  enabled: boolean
  digest_recipients: string[]
}

/**
 * 月预算这几列**故意跟 `AdStrategyConfig` 分开读**（子牙 2026-08-18 复审的阻止项 1）。
 *
 * 🔴 早先把新列塞进 `loadAdStrategyConfigWithSource` 的 select 里，后果是：
 *    migration 还没 apply 时 PostgREST 对不存在的列会让**整个查询报错**（42703），
 *    于是 `source` 变成 `'fallback'`，而每日广告体检 cron 的发信闸是
 *    `adConfigSource !== 'fallback'` —— **每个客户的广告日报邮件一封都不发，
 *    日志里只有一行 console.warn**。那是一条已上线功能的静默停摆，
 *    却是被一个还没上线的新功能带塌的。
 *
 *    拆开之后：列不存在只让**新功能**降级（预算读不到 → 待办整轮不下发，
 *    另有一条系统级待办说明原因），碰不到日报。
 */
export interface AdBudgetFields {
  /**
   * 客户这个月**准备投**的广告预算 —— 不是已经花掉的。
   *
   * 🔴 `null` 和 `0` 是两件事，别合并：
   *   · `null` = 还没问到 → 探索池算不出来，进今日待办催人去问；
   *   · `0`    = 数据库层直接拒绝（见 migration 的 `> 0` 约束）——
   *     「这个月不投」的表达方式是不填，不是填 0。填 0 会让探索池算出 0、
   *     臂数算出 0，看起来像「算过了，结论是别测」，实际是有人填错了。
   */
  monthly_ad_budget: number | null
  /** 预算币种。与金额成对出现（数据库层有 paired 约束）。 */
  monthly_ad_budget_currency: AdBudgetCurrency | null
  /** 最后一次填的时间 —— 给人看「什么时候确认的」，**不再用来推算哪个月**。 */
  monthly_ad_budget_updated_at: string | null
  /**
   * 这笔预算（或这次「本月不投」的决定）算哪个业务月，`YYYY-MM`。
   *
   * 🔴 写入时按**客户自己所在国**的时区算好存下来，读侧只做字符串比对。
   *    不从 `updated_at` 推：推的那一刻用错时区就永久错（原 C1，
   *    悉尼 9/30 22:30 保存的 9 月预算按 NZ 推会变成 10 月，整月不再复核）。
   */
  monthly_ad_budget_month: string | null
}

/** 空的预算三态 —— 「还没问到」。 */
export function emptyBudgetFields(): AdBudgetFields {
  return {
    monthly_ad_budget: null,
    monthly_ad_budget_currency: null,
    monthly_ad_budget_updated_at: null,
    monthly_ad_budget_month: null,
  }
}

/**
 * Where a loaded config came from:
 *  - 'row'      an actual configured row
 *  - 'default'  no row exists (a fresh client — legitimately on)
 *  - 'fallback' the read FAILED, so `enabled` here is a guess, not the truth
 */
export type ConfigSource = 'row' | 'default' | 'fallback'

/** Default when a client has no config row: on, digest to the global inbox. */
export function defaultConfig(clientId: string): AdStrategyConfig {
  return {
    client_id: clientId,
    enabled: true,
    digest_recipients: [],
  }
}

/**
 * Load one client's config with provenance. Never throws.
 *
 * Fail-open is asymmetric on purpose (魏征): a config-table hiccup must not lose
 * data collection, so on error we still return enabled=true — but we mark it
 * `fallback` so the caller can be conservative about the IRREVERSIBLE side
 * (sending email). A client an FDE deliberately paused must not be silently
 * re-opened and emailed because of a transient read error.
 */
export async function loadAdStrategyConfigWithSource(
  clientId: string,
): Promise<{ config: AdStrategyConfig; source: ConfigSource }> {
  /**
   * 🔴 **只 select 这张表原有的三列，绝不把新加的列塞进来。**
   *
   *    这条查询喂的是每日广告体检 cron 的发信闸（`adConfigSource !== 'fallback'`）。
   *    PostgREST 对不存在的列是**整个查询报错**（42703），不是把那列返回 null ——
   *    所以只要往这里加一个还没 apply 到生产的列，日报邮件就会全客户静默停发。
   *    新字段一律另开读函数（见 `loadAdBudgetFields`），让降级只影响新功能。
   */
  const { data, error } = await supabaseAdmin
    .from('ad_strategy_configs')
    .select('client_id, enabled, digest_recipients')
    .eq('client_id', clientId)
    .maybeSingle()

  if (error) {
    console.warn(`[ad-strategy] config read failed for ${clientId}, falling back to enabled:`, error.message)
    return { config: defaultConfig(clientId), source: 'fallback' }
  }
  if (!data) return { config: defaultConfig(clientId), source: 'default' }

  return {
    config: {
      client_id: clientId,
      enabled: data.enabled ?? true,
      digest_recipients: Array.isArray(data.digest_recipients) ? data.digest_recipients : [],
    },
    source: 'row',
  }
}

/**
 * 读一个客户的月预算字段。**读不到就返回 `null`，不是返回「都没填」。**
 *
 * 🔴 这两件事必须分得开（「空」有三种来路）：
 *    · 返回 `emptyBudgetFields()` = 真的没填 → 该催；
 *    · 返回 `null`                = 没查到（多半是 migration 还没 apply）
 *      → 不该催，该说「这个功能还没生效」。
 *    把后者当成前者，就会给每个客户推一条谁也处理不了的噪音。
 */
export async function loadAdBudgetFields(clientId: string): Promise<AdBudgetFields | null> {
  const { data, error } = await supabaseAdmin
    .from('ad_strategy_configs')
    .select(
      'monthly_ad_budget, monthly_ad_budget_currency, monthly_ad_budget_updated_at, monthly_ad_budget_month',
    )
    .eq('client_id', clientId)
    .maybeSingle()

  if (error) {
    console.warn(`[ad-strategy] budget read failed for ${clientId}:`, error.message)
    return null
  }
  if (!data) return emptyBudgetFields()
  return normalizeBudgetFields(data)
}

/**
 * 把库里回来的一行收敛成预算三件套 —— 读侧唯一的口径，服务端与待办共用。
 *
 * 🔴 成对才算数：库里有 paired 约束，但读侧不依赖「约束一定没被绕过」——
 *    只有金额没有币种时当成没填，不猜一个币种出来（`AD-CUR-1` 就是这么来的）。
 */
export function normalizeBudgetFields(row: Record<string, unknown>): AdBudgetFields {
  // 🔴 金额只认「真实金额」。numeric 经 PostgREST 回来可能是数字也可能是字符串，
  //    而 `Number('')` 是 0、`Number(null)` 也是 0 —— 直接 Number() 会把「没填」
  //    变成「填了 0」，正是必须分开的两件事。
  const budget = toRealAmount(row.monthly_ad_budget)
  const currency = isAdBudgetCurrency(row.monthly_ad_budget_currency)
    ? row.monthly_ad_budget_currency
    : null
  const paired = budget !== null && currency !== null
  return {
    monthly_ad_budget: paired ? budget : null,
    monthly_ad_budget_currency: paired ? currency : null,
    monthly_ad_budget_updated_at:
      typeof row.monthly_ad_budget_updated_at === 'string' ? row.monthly_ad_budget_updated_at : null,
    // 形状不对就当没有 —— 歪掉的月份比对不上，会变成「看起来填了、待办天天催」，
    // 而库里那条 CHECK 已经拦住了正常写入路径，能走到这里的只有手改过的数据。
    monthly_ad_budget_month: isBusinessMonth(row.monthly_ad_budget_month)
      ? row.monthly_ad_budget_month
      : null,
  }
}

/**
 * 把库里回来的金额收敛成「一个真实的正金额，或 null」。
 *
 * 判据跟 migration 的 CHECK 一致（NaN / Infinity / 非正数一律不算），
 * 外加空串与 null 都不许变成 0 —— 「没填」和「填了 0」必须分得开。
 */
export function toRealAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  // 🔴 只认数字和数字字符串。`Number()` 对别的类型太宽容 ——
  //    `Number(true) === 1`、`Number([2000]) === 2000`，于是一个坏掉的调用方
  //    能把「预算 1 元」写进库，而数据库约束（> 0）看不出这是类型转换出来的。
  //    金额这种东西宁可拒绝，也不要猜。
  if (typeof raw !== 'number' && typeof raw !== 'string') return null
  if (typeof raw === 'string' && raw.trim() === '') return null
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * 把一次 PATCH 请求翻译成该写进库的那一行 —— **纯函数，可直接测**。
 *
 * 🔴 为什么从路由里抽出来（魏征 2026-08-18 复审的阻止项 B1）：
 *    整套四态判定（填了 / 上月的 / 本月确认不投 / 从没问过）唯一的锚点，就是
 *    这里写不写 `monthly_ad_budget_month` + `monthly_ad_budget_updated_at`。
 *    这两行原本躺在路由里，而那个路由**一个测试都没有** —— 实测把写时间戳那
 *    一行整行删掉，403 个测试全绿。也就是说，日后任何一次无关重构删掉它，
 *    没有任何东西会响：FDE 清空预算之后界面照旧说「还没填」，
 *    而今日待办每天继续催同一个客户到月底。
 *
 * 🔴 月份按**客户自己所在国**的时区算（`country`），不按全局时区 —— 原 C1。
 */
export function buildConfigUpdate(input: {
  clientId: string
  body: Record<string, unknown>
  /** 谁在改 —— 留审计痕迹，判定不读它。 */
  actorEmail: string | null
  /** `clients.country`，决定这笔预算算哪个月。判不出来按 NZ（见 business-month）。 */
  country: unknown
  now: Date
}): { ok: true; update: Record<string, unknown> } | { ok: false; error: string } {
  const { clientId, body, actorEmail, country, now } = input
  const update: Record<string, unknown> = {
    client_id: clientId,
    updated_at: now.toISOString(),
  }

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') return { ok: false, error: 'enabled must be a boolean' }
    update.enabled = body.enabled
  }

  if (body.digest_recipients !== undefined) {
    if (!Array.isArray(body.digest_recipients) || body.digest_recipients.some(e => typeof e !== 'string')) {
      return { ok: false, error: 'digest_recipients must be an array of strings' }
    }
    const emails = (body.digest_recipients as string[]).map(e => e.trim()).filter(Boolean)
    const bad = emails.find(e => !EMAIL_RE.test(e))
    if (bad) return { ok: false, error: `Invalid email: ${bad}` }
    update.digest_recipients = emails
  }

  const patch = parseBudgetPatch(body)
  if (!patch.ok) return { ok: false, error: patch.error }
  if (patch.kind !== 'untouched') {
    update.monthly_ad_budget = patch.kind === 'clear' ? null : patch.amount
    update.monthly_ad_budget_currency = patch.kind === 'clear' ? null : patch.currency
    // 🔴 这三行是四态判定的全部锚点，删掉任何一行都会让待办永远催或永远不催。
    //    「清空」也要写 —— 那是「本月确认不投」这个决定本身。
    update.monthly_ad_budget_updated_at = now.toISOString()
    update.monthly_ad_budget_month = businessMonth(now, timeZoneForCountry(country))
    update.monthly_ad_budget_updated_by = actorEmail
  }

  return { ok: true, update }
}

/** Convenience wrapper for readers that don't care about provenance (e.g. the API). */
export async function loadAdStrategyConfig(clientId: string): Promise<AdStrategyConfig> {
  return (await loadAdStrategyConfigWithSource(clientId)).config
}

/**
 * Resolve the recipients for a client's digest: their configured list, or the
 * global ME inbox when none is set.
 */
export function resolveDigestRecipients(
  // 只声明真正读到的那一个字段：这个函数跟预算、开关都无关，
  // 要求调用方（含测试）造一个完整配置对象纯属噪音。
  config: Pick<AdStrategyConfig, 'digest_recipients'>,
): string[] {
  if (config.digest_recipients.length > 0) return config.digest_recipients
  return [process.env.AD_HEALTH_DIGEST_TO || ME_MAIL_TO_ADDRESS]
}
