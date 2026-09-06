/**
 * 日报邮件里「Failures」那一格显示什么 —— 一个纯函数，好让它能被断言。
 *
 * WHY
 * ---
 * 日报捞的是 `failed_count > 0 || status = 'failed'` 的跑。这两个条件不是同一件事：
 * 一次跑完全可以「一个待办对象都没失败（`failed_count = 0`），但这次跑整体没干成
 * 该干的事（`status = 'failed'`）」。原来那一格硬写 `${failed_count} failed`，
 * 这种跑就显示成红色的 **「0 failed」** —— 表头还写着 Cron Job Failures，自相矛盾，
 * 看的人只会当成显示 bug 划过去。
 *
 * 真实触发场景：`meta-leads-sync` 的 Mailchimp 出口坏了 —— 线索全都进了 CRM
 * （所以「取不到线索的客户数」= 0），但一个人都没进邮件名单。这次跑必须被看见，
 * 且不能谎称有 N 个客户失败。
 */

export interface DigestRunRow {
  status?: string | null
  failed_count?: number | null
}

/**
 * `N failed`（真有 N 个对象失败）/ `needs attention`（这次跑没干成，但没有可数的
 * 失败对象）。后者把「看错误原因那一列」这件事交给下一格，不编造数字。
 */
export function failureCell(run: DigestRunRow): string {
  const n = run.failed_count ?? 0
  if (n > 0) return `${n} failed`
  return run.status === 'failed' ? 'needs attention' : '0 failed'
}
