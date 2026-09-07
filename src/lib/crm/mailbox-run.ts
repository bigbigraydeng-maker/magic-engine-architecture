/**
 * 「公司邮箱那趟同步，最近一轮到底怎么样」——**只读，一行写操作都没有。**
 *
 * ## 为什么单独成一个文件
 *
 * 两个消费方都少不了它，而且是同一个理由：
 *
 *   · 今日待办（`pm-todo/email-reply-items.ts`）
 *   · 给销售的汇总信（`api/cron/email-reply-digest`）
 *
 * 邮箱没同步进来时，「客人来信没人回」自然是零条 —— **一个哑掉的通道和一个
 * 健康的通道长得一模一样**，那个零是假的。所以「同步本身出事了」必须跟结果
 * 并排出现，两个消费方都不能少这一句。
 *
 * ## 🔴 取「最近一轮」不能只按 started_at 拿第一行
 *
 * `startCronRun` 是在任务**开始时**就插一行 `status='running'` / `summary=null`，
 * summary 要 `finish()` 才写。按 started_at 取第一行，随时可能拿到一行还没写
 * summary 的记录 —— 于是「同步刚好在跑 / 刚好卡死」的那一刻，这道守卫自己闭嘴
 * （fail-open：守卫在最需要它的那一刻失效）。
 *
 * 所以只认**已经写下 summary 的终态行**，并且把「最新一行还卡在 running」
 * 单独说出来，不跟「记录太旧」一起吞掉。
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** 每小时一轮的那条任务，邮箱同步搭在它里面（见 messenger-sync-hourly 文件头）。 */
export const MAILBOX_SYNC_JOB = 'messenger-sync-hourly'

/**
 * 运行记录多旧就不能拿来当今天的判据。
 *
 * 那条任务每小时一轮，两天足够宽松。「该跑没跑」有 `pushCronHealthItems` 在管，
 * 这里不重复报 —— 同一件事报两遍，人会开始整栏跳过。
 */
export const MAILBOX_RUN_STALE_DAYS = 2

/**
 * 开跑超过这么久还没写完 = 卡死了。
 *
 * 每小时一轮，正常一轮几分钟。3 小时既躲开了「正在跑」的正常窗口，
 * 又不至于让一次真卡死躲过一整天。
 */
export const MAILBOX_RUN_STUCK_HOURS = 3

/** 同步那趟自己写进运行记录的 mailbox 那一段。当**已经落库的旧数据**处理。 */
export interface MailboxRunResult {
  clientId?: string
  clientName?: string | null
  mailbox?: string
  stoppedEarly?: string
  error?: string
}

export interface MailboxSummary {
  mailboxes?: number
  error?: string | null
  results?: MailboxRunResult[]
}

interface SyncRunSummary {
  mailbox?: MailboxSummary | null
}

interface RunRow {
  status: string | null
  started_at: string | null
  finished_at: string | null
  summary: SyncRunSummary | null
}

/**
 * 最近一轮同步的状态。
 *
 * `unknown` 是「说不出话」而不是「一切正常」：没有可用记录 / 记录太旧 /
 * 终态行没写 summary 都归它，那些由 `pushCronHealthItems` 和 daily-cron-digest
 * 各自在管，这里不重复报。
 */
export type MailboxRunState =
  | { kind: 'ok'; mailbox: MailboxSummary | null }
  | { kind: 'stuck'; startedAt: string; hours: number }
  | { kind: 'unknown' }

/** 往前看几行才找得到终态行 —— 卡死的 running 行会堆在最前面。 */
const RECENT_ROWS = 5

function hoursSince(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (now.getTime() - t) / 3_600_000
}

export async function loadMailboxRun(
  supabase: SupabaseClient,
  now: Date,
): Promise<MailboxRunState> {
  const { data } = await supabase
    .from('cron_run_logs')
    .select('status, started_at, finished_at, summary')
    .eq('job_name', MAILBOX_SYNC_JOB)
    .order('started_at', { ascending: false })
    .limit(RECENT_ROWS)

  const rows = (data ?? []) as RunRow[]

  // 终态行（completed / failed 都算）才有 summary 可读；在跑的行跳过。
  const terminal = rows.find((r) => r.status !== 'running')
  if (terminal?.summary) {
    const hours = hoursSince(terminal.finished_at, now)
    if (hours !== null && hours <= MAILBOX_RUN_STALE_DAYS * 24) {
      return { kind: 'ok', mailbox: terminal.summary.mailbox ?? null }
    }
  }

  // 最新一行还卡在「在跑」→ 这趟根本没写完，信没进来。单独说，别跟「太旧」混。
  const newest = rows[0]
  if (newest?.status === 'running' && newest.started_at) {
    const hours = hoursSince(newest.started_at, now)
    if (hours !== null && hours > MAILBOX_RUN_STUCK_HOURS) {
      return { kind: 'stuck', startedAt: newest.started_at, hours: Math.floor(hours) }
    }
  }

  return { kind: 'unknown' }
}
