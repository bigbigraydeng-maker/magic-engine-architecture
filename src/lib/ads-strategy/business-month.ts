/**
 * 「业务月份」判据 —— 纯函数、零依赖，服务端（待办生成）与设置页共用同一份。
 *
 * 🔴 为什么不能用 UTC：`ad_daily_insights.insight_date` 是广告账户所在地的
 *    **本地日期**（AU/NZ），而今日待办的 cron 固定 19:00 UTC 跑。用 UTC 算月初
 *    会在每月第一天出错：9 月 1 日 07:00 NZ 时 UTC 还是 8 月 31 日 →
 *    窗口从 8 月 1 日开始 → 把上个月一整月的花费当成「这个月」报出来。
 *
 * 🔴 **月份按客户自己所在国算，不按一个全局时区算**（子牙 / 魏征 2026-08-18 复审，
 *    原 Codex 第四轮 P2「C1」的根治）。原先固定用 NZ 时区判断预算属于哪个月，
 *    对 **AU 客户**有一个真实的错判窗口：
 *
 *      悉尼 9/30 22:30 保存的「9 月预算」→ 此刻 NZ 已是 10/1 →
 *      被记成「10 月已确认」→ 整个 10 月不再生成复核待办。
 *
 *    这不是纸面风险：三个在投客户里花钱最多的 Oztop 就是 AU（`clients.country`
 *    生产实测 CTS=NZ / Oztop=AU / Roman=NZ，三个都填对了）。
 *
 * 🔴 而且**月份要存下来，不要每次从时间戳推**（见 `monthly_ad_budget_month` 列）。
 *    「填的时刻」和「这笔预算算哪个月的」是两件事；推的那一刻用错时区就永久错，
 *    存下来则是当时按客户自己的时区算好的事实，以后升级成月度历史表也是精确的。
 */

/** 目标市场只有 AU/NZ，所以业务时区也只有这两个。 */
export type BusinessTimeZone = 'Pacific/Auckland' | 'Australia/Sydney'

/**
 * 判不出国家时用 NZ —— 本仓主市场（CLAUDE.md 时区写的是 NZST/AEST），
 * 且 NZ 比 AU 早，落到 AU 客户身上最坏结果是**月末那两小时多催一次**（无害），
 * 而不是**整月不催**（有害）。方向必须是这一边。
 */
export const DEFAULT_BUSINESS_TZ: BusinessTimeZone = 'Pacific/Auckland'

/** 客户所在国 → 业务时区。判不出来一律 NZ，理由见 `DEFAULT_BUSINESS_TZ`。 */
export function timeZoneForCountry(country: unknown): BusinessTimeZone {
  if (typeof country !== 'string') return DEFAULT_BUSINESS_TZ
  switch (country.trim().toUpperCase()) {
    case 'AU':
    case 'AUS':
    case 'AUSTRALIA':
      return 'Australia/Sydney'
    default:
      return DEFAULT_BUSINESS_TZ
  }
}

const FORMATTERS = new Map<BusinessTimeZone, Intl.DateTimeFormat>()

function formatterFor(tz: BusinessTimeZone): Intl.DateTimeFormat {
  let f = FORMATTERS.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' })
    FORMATTERS.set(tz, f)
  }
  return f
}

/** 该时刻在指定业务时区里所属的月份，`YYYY-MM`。 */
export function businessMonth(d: Date, tz: BusinessTimeZone = DEFAULT_BUSINESS_TZ): string {
  return formatterFor(tz).format(d).slice(0, 7)
}

/**
 * 本业务月的第一天，`YYYY-MM-DD`，用来截 `insight_date`。
 *
 * ⚠️ 这一个**刻意仍按 NZ 算**，不按客户切：它是一条覆盖所有客户的花费查询的
 *    下界（`loadMonthSpendByClient` 一次查全部客户），按客户切就得拆成 N 条查询。
 *    NZ 比 AU 早，所以对 AU 客户这个下界最多**早两小时**收窄一天 ——
 *    影响的是「这个月有没有花钱」这个粗判据，不是钱算哪个月，可接受。
 */
export function businessMonthStart(d: Date): string {
  return `${businessMonth(d, DEFAULT_BUSINESS_TZ)}-01`
}

/** `YYYY-MM` 的形状校验 —— 库里那条 CHECK 的 TS 侧镜像。 */
export function isBusinessMonth(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)
}
