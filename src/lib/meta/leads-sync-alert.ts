/**
 * 把 meta-leads-sync 每个客户各自的成败，压成一行人话喂给
 * `cron_run_logs.error_message` —— 日报邮件的「错误原因」列读的就是这个字段。
 *
 * WHY
 * ---
 * 2026-08-21~08-30，4 个客户（CTS Tours NZ / Roman HU / Magic Lab Class /
 * NZCPE 2026）线索管道全线断供 9 天。日报**每天都在发**（`failed_count=4`
 * 稳稳命中告警条件），但因为 cron 从不给 `finish()` 传 `error`，邮件里是
 * 24 行一模一样的「meta-leads-sync 4 failed —」，一个字都没说是什么事。
 * 真正的报错当时就躺在 summary 里，只是没被搬到人看得见的地方。
 * 告警发了等于没发，CTS 一家漏 45 条线索、NZ$736 白花。
 *
 * 住在 lib 而不是 route 里，有两个理由：Next.js 的 `route.ts` 只允许导出
 * 路由处理器和几个约定配置，多导出一个函数会直接类型检查报错；而且路由层
 * 本就该只放路由。
 */

/** 只取这个摘要用得上的两个字段，故意不绑死 MetaLeadsSyncResult 全貌。 */
export interface LeadsSyncOutcome {
  clientName: string | null
  error?: string
}

/** 单个客户的原因截断长度 —— 防一家的长报错挤掉其他家。 */
const MAX_REASON_CHARS = 160

/**
 * 全好时返回 undefined，`finish()` 就仍把这次跑标成 completed —— 不制造新噪音。
 *
 * **按报错原文去重**是关键，不是顺手优化：一把令牌失效时 N 家的报错是同一句，
 * 不去重会把邮件仅有的 200 字符用同一句话刷满，真正不同的病因反而被挤掉。
 */
export function summariseFailures(results: readonly LeadsSyncOutcome[]): string | undefined {
  const failures = results.filter((r) => r.error)
  if (failures.length === 0) return undefined

  const byReason = new Map<string, string[]>()
  for (const f of failures) {
    const reason = (f.error ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_REASON_CHARS)
    const names = byReason.get(reason) ?? []
    names.push(f.clientName ?? '(未命名客户)')
    byReason.set(reason, names)
  }

  const parts = Array.from(byReason, ([reason, names]) => `${names.join('/')}: ${reason}`)
  return `${failures.length}/${results.length} 个客户取不到线索 — ${parts.join(' ‖ ')}`
}
