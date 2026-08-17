/**
 * 「业务月份」按 **NZ 本地时间** 算，不按 UTC。
 *
 * 🔴 为什么不能用 UTC：`ad_daily_insights.insight_date` 是广告账户所在地的
 *    **本地日期**（AU/NZ），而今日待办的 cron 固定 19:00 UTC 跑。用 UTC 算月初
 *    会在每月第一天出错：9 月 1 日 07:00 NZ 时 UTC 还是 8 月 31 日 →
 *    窗口从 8 月 1 日开始 → 把上个月一整月的花费当成「这个月」报出来。
 *
 * 🔴 取 NZ 而不是 AU：19:00 UTC 那一刻 NZ(+12/13) 与 AU(+10/11) 都已进入新的
 *    一天，两边同月；NZ 也是本仓主市场（CLAUDE.md 时区写的是 NZST/AEST）。
 *
 * ⚠️ **已知缺陷，PM 2026-08-17 决定留给设计复审，不在本 PR 修**（PR #1036 第四轮
 *    Codex P2）。固定用 NZ 时区对 **AU 客户**有一个真实的错判窗口：
 *
 *      悉尼 9/30 22:30 保存的「9 月预算」→ 此刻 NZ 已是 10/1 →
 *      被记成「10 月已确认」→ 整个 10 月不再生成复核待办。
 *
 *    🔴 早先这里写过「残留误差不影响任何判定结论」—— **那句话已经不成立，已删**：
 *    本函数现在还被 `loadBudgetStateByClient` 与设置页用来判断
 *    `monthly_ad_budget_updated_at` 属于哪个月，那就是一个判定结论。
 *
 *    正确修法：按客户所在国切时区（AU → `Australia/Sydney`，NZ → `Pacific/Auckland`），
 *    `clients.country` 已有且三个在投客户都填对了；难点只在于
 *    `loadBudgetStateByClient` 需要额外把 country 取出来。
 *
 * 🔴 **纯函数、零依赖** —— 服务端（待办生成）和浏览器端（设置页）都要用它判断
 *    「这个数是不是这个月填的」，两边必须是同一份判据，不能各写一份。
 */

const NZ_MONTH_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Pacific/Auckland',
  year: 'numeric',
  month: '2-digit',
})

/** 该时刻所属的业务月份，`YYYY-MM`。 */
export function businessMonth(d: Date): string {
  return NZ_MONTH_FORMAT.format(d).slice(0, 7)
}

/** 本业务月的第一天，`YYYY-MM-DD`，用来截 `insight_date`。 */
export function businessMonthStart(d: Date): string {
  return `${businessMonth(d)}-01`
}

/**
 * 这个时间戳是不是落在 `now` 所属的业务月里。
 *
 * 解析不出来一律返回 false —— 方向安全：宁可多问一次，也不要拿一个说不清是
 * 哪个月的数字去算花钱额度。
 */
export function isInBusinessMonth(iso: string | null | undefined, now: Date): boolean {
  if (!iso) return false
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return false
  return businessMonth(new Date(t)) === businessMonth(now)
}
