/**
 * P21.K.5 — Ad Strategy Engine per-client configuration.
 *
 * Loads a client's control settings (on/off, digest routing), falling back to
 * safe defaults when no row exists so the engine works for a client the moment
 * they have a Meta account — no config step required to start.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { ME_MAIL_TO_ADDRESS } from '@/lib/email/sender'

/** 目标市场 AU/NZ —— 账户币种实读只有这两个（`AD-CUR-1`）。 */
export type AdBudgetCurrency = 'AUD' | 'NZD'

export const AD_BUDGET_CURRENCIES: readonly AdBudgetCurrency[] = ['AUD', 'NZD']

export function isAdBudgetCurrency(v: unknown): v is AdBudgetCurrency {
  return typeof v === 'string' && (AD_BUDGET_CURRENCIES as readonly string[]).includes(v)
}

export interface AdStrategyConfig {
  client_id: string
  enabled: boolean
  digest_recipients: string[]
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
  /** 最后一次填的时间 —— 预算是会变的业务事实，没有它说不清这个数还新不新。 */
  monthly_ad_budget_updated_at: string | null
}

/**
 * Where a loaded config came from:
 *  - 'row'      an actual configured row
 *  - 'default'  no row exists (a fresh client — legitimately on)
 *  - 'fallback' the read FAILED, so `enabled` here is a guess, not the truth
 */
export type ConfigSource = 'row' | 'default' | 'fallback'

/**
 * Default when a client has no config row: on, digest to the global inbox.
 *
 * 🔴 预算默认 `null`（还没问到），**不给任何猜测值**。给个默认数字会让 SOP 的
 *    探索池算出一个看起来合理、其实没人确认过的金额，而那笔钱是真要花出去的。
 */
export function defaultConfig(clientId: string): AdStrategyConfig {
  return {
    client_id: clientId,
    enabled: true,
    digest_recipients: [],
    monthly_ad_budget: null,
    monthly_ad_budget_currency: null,
    monthly_ad_budget_updated_at: null,
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
  const { data, error } = await supabaseAdmin
    .from('ad_strategy_configs')
    .select(
      'client_id, enabled, digest_recipients, monthly_ad_budget, monthly_ad_budget_currency, monthly_ad_budget_updated_at',
    )
    .eq('client_id', clientId)
    .maybeSingle()

  if (error) {
    console.warn(`[ad-strategy] config read failed for ${clientId}, falling back to enabled:`, error.message)
    return { config: defaultConfig(clientId), source: 'fallback' }
  }
  if (!data) return { config: defaultConfig(clientId), source: 'default' }

  // 🔴 金额只认「真实金额」。numeric 经 PostgREST 回来可能是数字也可能是字符串，
  //    而 `Number('')` 是 0、`Number(null)` 也是 0 —— 直接 Number() 会把「没填」
  //    变成「填了 0」，正是上面注释里说的那个必须分开的两件事。
  const budget = toRealAmount(data.monthly_ad_budget)
  const currency = isAdBudgetCurrency(data.monthly_ad_budget_currency)
    ? data.monthly_ad_budget_currency
    : null

  return {
    config: {
      client_id: clientId,
      enabled: data.enabled ?? true,
      digest_recipients: Array.isArray(data.digest_recipients) ? data.digest_recipients : [],
      // 成对才算数：库里有 paired 约束，但读侧不依赖「约束一定没被绕过」——
      // 只有金额没有币种时当成没填，不猜一个币种出来（`AD-CUR-1` 就是这么来的）。
      monthly_ad_budget: budget !== null && currency !== null ? budget : null,
      monthly_ad_budget_currency: budget !== null && currency !== null ? currency : null,
      monthly_ad_budget_updated_at:
        typeof data.monthly_ad_budget_updated_at === 'string' ? data.monthly_ad_budget_updated_at : null,
    },
    source: 'row',
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
  if (typeof raw === 'string' && raw.trim() === '') return null
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
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
