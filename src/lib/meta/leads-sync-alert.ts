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
 *
 * 这里报**两类**不同的病，故意不混成一句：
 *   1. 取不到线索 —— 人根本没进来（`summariseFailures`）
 *   2. 线索进来了，但没进邮件名单 —— 人进了 CRM，Mailchimp 出口把他丢了
 *      （`summariseOutletGaps`）
 * 第 2 类是 2026-08~09 的第二次静默事故：`clients.mailchimp_audience_id`
 * 那一列没 apply 到生产，出口每小时静默 skip，`leadsIngested` 照常涨，
 * 看起来一切正常，一整个月没人看得见。它**不是**「取不到线索」，说成那样
 * 就是在日报里说假话；也**不该**把客户算进 `failed_count`（那个数的语义是
 * 「取不到线索的客户数」，见 route.ts），否则就是过度告警。
 */

/** 只取这个摘要用得上的几个字段，故意不绑死 MetaLeadsSyncResult 全貌。 */
export interface LeadsSyncOutcome {
  clientName: string | null
  error?: string
  /**
   * Mailchimp 出口这一轮的结果分布，key = `subscribed` / `already_member` /
   * `skipped:<reason>` / `failed:<reason>`，value = 条数。由
   * `lib/meta/leads-sync.ts` 产出。可选：老的调用方（和这个字段落地之前的
   * 历史记录）没有它，当成「这一轮没有出口结果」处理，不报。
   */
  mailchimp?: Record<string, number>
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

  const byReason = groupByReason(failures.map((f) => ({ name: f.clientName, reason: f.error ?? '' })))
  return `${failures.length}/${results.length} 个客户取不到线索 — ${byReason.join(' ‖ ')}`
}

/**
 * 「本来就不该进名单」的跳过理由 —— 白名单，这几种一律不报。
 *
 * 为什么是白名单不是黑名单：默认必须是**说出来**。这个文件修的两次事故都是
 * 「新出现的一种失败没人认得，于是被默默咽掉」。新加的 reason 落到这里之外
 * 会自动进日报（最多吵一次，加一行就能压掉），反过来则是又一次静默断供。
 */
const EXPECTED_SKIP_REASONS = new Set([
  'no_email', // 表单没留邮箱，本来就进不去名单
  'invalid_email', // 邮箱不成形，provider 侧也收不了
  'explicit_opt_out', // 人在表单里明确勾了不要
  'contact_dnc', // 这个人已被标记免打扰
  'no_audience_config', // 这个客户没开邮件出口（查得到，就是没配）
  'no_audience_id', // 同上，provider 层的说法
])

/** 出口结果 tally 的 key → 给 PM 看的人话。key 的构成见 `LeadsSyncOutcome.mailchimp`。 */
const OUTLET_GAP_LABELS: Record<string, string> = {
  'skipped:client_config_read_failed': '读不出这个客户的邮件名单配置',
  'skipped:no_api_key': '名单配好了，但系统没有 Mailchimp 密钥',
  'skipped:bad_api_key_format': 'Mailchimp 密钥格式不对',
  'skipped:dnc_check_failed': '查不到这个人是否免打扰，保险起见没加',
  'skipped:evidence_persist_failed': '同步记录写不进库，保险起见没加',
  'failed:auth': 'Mailchimp 不认这个密钥',
  'failed:audience_not_found': 'Mailchimp 里找不到这个名单',
  'failed:rate_limited': 'Mailchimp 限流，这批没加进去',
  'failed:provider_5xx': 'Mailchimp 自己出错了',
  'failed:timeout': '连 Mailchimp 超时',
  'failed:network_error': '连不上 Mailchimp',
  'failed:invalid_email': 'Mailchimp 说这个邮箱不合法',
  'failed:unexpected_status': 'Mailchimp 返回了没见过的响应',
  'failed:unexpected_exception': '同步这个人时程序自己炸了',
}

/** 这个 tally key 算不算「本该进名单却没进」。 */
function isOutletGap(key: string): boolean {
  if (key.startsWith('failed:')) return true
  if (!key.startsWith('skipped:')) return false // subscribed / already_member 是好结果
  return !EXPECTED_SKIP_REASONS.has(key.slice('skipped:'.length))
}

/** 认识的 key 说人话；不认识的**照原样带出来**，绝不咽掉。 */
function outletGapLabel(key: string): string {
  return OUTLET_GAP_LABELS[key] ?? `邮件名单出口异常（${key}）`
}

/**
 * 「线索进来了，但没进邮件名单」—— 没有这种情况时返回 undefined。
 *
 * 跟 `summariseFailures` 一样**按原因分组**：一个共性故障（配置读不出来、
 * 密钥失效）会同时打中所有客户，不合并就会把邮件仅有的 200 字符刷满同一句话。
 *
 * 条数是「这一轮有多少个人本该进名单却没进」，不是客户数 —— PM 关心的是漏了
 * 多少人，不是几家出问题。
 */
export function summariseOutletGaps(results: readonly LeadsSyncOutcome[]): string | undefined {
  const rows: { name: string | null; reason: string; count: number }[] = []
  let total = 0

  for (const r of results) {
    for (const [key, count] of Object.entries(r.mailchimp ?? {})) {
      if (count <= 0 || !isOutletGap(key)) continue
      rows.push({ name: r.clientName, reason: outletGapLabel(key), count })
      total += count
    }
  }
  if (total === 0) return undefined

  return `${total} 条线索进了 CRM 但没进邮件名单 — ${groupByReason(rows).join(' ‖ ')}`
}

/**
 * 喂给 `cronRun.finish({ error })` 的那一行。两类病都没有时 undefined
 * （这次跑仍标 completed，不制造新噪音）。
 *
 * 「取不到线索」排在前面：人根本没进来比「进来了没进名单」严重，而日报邮件
 * 只截前 200 字符，先说的那句才保证看得见。两句的完整原文都在
 * `cron_run_logs.error_message` 里，追查时不会丢。
 */
export function summariseSyncProblems(results: readonly LeadsSyncOutcome[]): string | undefined {
  const parts = [summariseFailures(results), summariseOutletGaps(results)].filter(
    (p): p is string => Boolean(p),
  )
  return parts.length > 0 ? parts.join('；') : undefined
}

/**
 * 按「原因原文」把客户合并成组：`客户A/客户B: 原因 [N 条]`。
 *
 * 去重是共用的，因为两类病共用同一个死因：共性故障会让 N 家给出一模一样的
 * 那句话，不合并就把邮件的 200 字符全刷成同一句，真正不同的病因反而被挤掉。
 */
function groupByReason(
  rows: readonly { name: string | null; reason: string; count?: number }[],
): string[] {
  const byReason = new Map<string, { names: Set<string>; count: number; counted: boolean }>()

  for (const row of rows) {
    const reason = row.reason.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON_CHARS)
    const group = byReason.get(reason) ?? { names: new Set<string>(), count: 0, counted: false }
    group.names.add(row.name ?? '(未命名客户)')
    if (row.count !== undefined) {
      group.count += row.count
      group.counted = true
    }
    byReason.set(reason, group)
  }

  return Array.from(byReason, ([reason, g]) => {
    const names = Array.from(g.names).join('/')
    return g.counted ? `${names}: ${reason} ${g.count} 条` : `${names}: ${reason}`
  })
}
