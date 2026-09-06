/**
 * 每周 SEO 快照 —— 派单 / 干活 两段的纯逻辑（PM 2026-09-07 拍板「开」）。
 *
 * 背景：这条链路的代码 2026-05-18 就写好了（P12.B.4），但**从来没跑过一次** ——
 * 生产库 cron_run_logs 里 `flywheel-seo-weekly` 是 0 条。2026-08-06 的架构审计把它
 * 标成「等 PM 拍板」，因为它每周要对每个在服务的客户各花一次 SEO 数据的钱。
 * 2026-09-07 PM 拍板开，并要求按 CLAUDE.md 的 Inngest 硬约束改成工作流。
 *
 * 🔴 **为什么要拆成「派单 + 干活」两段，而不是原来那样一个请求串着跑完**：
 *    原实现在一个 HTTP 请求里 for 循环跑完所有客户，`maxDuration = 900`。这形态有三个
 *    死法，而且死了都不留痕：跑到第 5 个客户超时 → 前 4 个写了、后面的没写，但运行记录
 *    只有一条「完成」；任何一个客户的 provider 调用卡住 → 整批陪葬；重试 = 已经付过钱的
 *    客户再付一次。拆开之后，每个客户是一个独立的、可重试的、带回执的单元。
 *
 * 🔴 **本文件不 import supabase、不 import adapter**：全部靠调用方注入。
 *    这样测试能直接跑纯函数，也让登记清单的对账测试可以只 import 调度常量而不拖起整个
 *    数据库连接（client 组件引服务端模块整页崩是本仓踩过的坑，同一类问题）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 云端专属事件名 —— 本机 factory-worker 不消费（见 lib/inngest/client.ts 的
 * WORKER_OWNED_EVENTS，契约测试锁死「一事件一主」）。
 */
export const FLYWHEEL_SEO_SNAPSHOT_DUE_EVENT = 'flywheel/seo.snapshot.due'

/**
 * 派单的时刻表。**这里是唯一定义处**：Inngest 的 cron 触发器和登记清单都从这里取，
 * 登记清单的对账测试会断言两边一致 —— 不然改了一处忘了另一处，健康检查会按错的
 * 周期算逾期，而「算错的告警」跟「没有告警」一样没用。
 *
 * 每周一 05:15 新西兰时间：错开整点那一堆日更任务，也避开周日 17:00 的行业基准采集
 * （那条同样打 DataForSEO）。
 */
export const FLYWHEEL_SEO_WEEKLY_CRON = '15 5 * * 1'
export const FLYWHEEL_SEO_WEEKLY_TZ = 'Pacific/Auckland'

/** 写进 cron_run_logs 的名字。跟登记清单里的 jobName 必须一致。 */
export const FLYWHEEL_SEO_WEEKLY_JOB = 'flywheel-seo-weekly'

/**
 * 每个客户每次快照会打几次外部数据服务。
 *
 * 🔴 这个数字不是装饰：它是回执里「这一单花了多少」的唯一依据。
 *    `getDomainMetrics` 内部并发打两个接口（domain_rank_overview + backlinks/summary），
 *    改了那边这里必须同步改，否则回执会低报花费 —— 低报比不报更糟，因为它看起来是真的。
 */
export const PROVIDER_CALLS_PER_CLIENT = 2

/** 派单名单里的一条。 */
export interface SnapshotRosterEntry {
  readonly clientId: string
  readonly domain: string
}

export type RosterResult =
  | { readonly ok: true; readonly entries: readonly SnapshotRosterEntry[] }
  | { readonly ok: false; readonly reason: string }

/**
 * 谁该被扫：**在服务中 + 填了网址**。
 *
 * 🔴 判据只有这两条，没有任何客户名。填了网址就会被扫，这是**已经存在**的规则，
 *    本次上线没有改它 —— 但它有一个已知副作用，PITFALLS 里记着：给一个不买 SEO 的
 *    客户随手填一个占位网址，就会把他静默拉进每周付费扫描。要排除某个客户，
 *    正确做法是清掉他的网址或改他的服务状态，不是在这里加一张名单。
 */
export async function loadSnapshotRoster(supabase: SupabaseClient): Promise<RosterResult> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, domain')
    .eq('client_status', 'active')
    .not('domain', 'is', null)

  if (error) return { ok: false, reason: error.message }

  const entries = (data ?? []).flatMap((row): SnapshotRosterEntry[] => {
    const clientId = (row as { id?: unknown }).id
    const domain = (row as { domain?: unknown }).domain
    if (typeof clientId !== 'string' || clientId.length === 0) return []
    if (typeof domain !== 'string' || domain.trim().length === 0) return []
    return [{ clientId, domain: domain.trim() }]
  })

  return { ok: true, entries }
}

/**
 * ISO 8601 周编号（`2026-W37`）。
 *
 * 🔴 用途只有一个：拼出**每客户每周唯一**的事件 id，让 Inngest 按 id 去重。
 *    不这么做的话，同一周里手动补触发一次 = 所有客户的数据钱再花一遍。
 *    故意用「周」而不是「日期」：补触发通常发生在另一天，按日期去重等于没去重。
 */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = d.getUTCDay() || 7 // 周一=1 … 周日=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum) // 挪到本周的周四，ISO 周归属看周四
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** 每客户每周唯一的事件 id —— Inngest 的去重键。 */
export function snapshotEventId(clientId: string, weekKey: string): string {
  return `flywheel-seo-${weekKey}-${clientId}`
}

export interface SnapshotDueData {
  readonly client_id: string
  readonly domain: string
  readonly week_key: string
}

export type ParsedSnapshotDue =
  | { readonly ok: true; readonly value: SnapshotDueData }
  | { readonly ok: false; readonly reason: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WEEK_KEY_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/

/**
 * 收到的派单条子合不合法（fail-closed）。
 *
 * 🔴 缺字段一律拒，绝不「缺了当默认值继续」—— 这一段后面就是花钱的 provider 调用，
 *    拿一个来路不明的 client_id 去扫，扫的是谁的钱都说不清。
 */
export function parseSnapshotDue(raw: unknown): ParsedSnapshotDue {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'payload_not_object' }
  const d = raw as Record<string, unknown>
  if (typeof d.client_id !== 'string' || !UUID_RE.test(d.client_id)) {
    return { ok: false, reason: 'invalid_client_id' }
  }
  if (typeof d.domain !== 'string' || d.domain.trim().length === 0 || d.domain.length > 253) {
    return { ok: false, reason: 'invalid_domain' }
  }
  if (typeof d.week_key !== 'string' || !WEEK_KEY_RE.test(d.week_key)) {
    return { ok: false, reason: 'invalid_week_key' }
  }
  return { ok: true, value: { client_id: d.client_id, domain: d.domain.trim(), week_key: d.week_key } }
}

/**
 * 一个客户的快照回执。字段按 CLAUDE.md 对 Inngest 回执的要求来：
 * 谁（client_id / domain）· 哪一单（week_key）· 结果（status）· 花了多少（provider_calls）
 * · 有没有对外发布（no_publish 恒 true，这条链路只读取和入库）· 什么时候（created_at）。
 */
export interface SnapshotReceipt {
  readonly client_id: string
  readonly domain: string
  readonly week_key: string
  readonly status: 'completed' | 'failed'
  readonly metrics_written: number
  readonly provider_calls: number
  readonly no_publish: true
  readonly error: string | null
  readonly created_at: string
}

/**
 * 干一个客户的活。
 *
 * 🔴 **失败也返回回执，不往外抛**：抛出去 Inngest 会重试，而 provider 那一笔钱已经花了 ——
 *    重试等于重复付款。这里把失败变成一条 status=failed 的回执，钱花了几次如实写在
 *    provider_calls 里。真正该重试的是「根本没打出去」的情况，那种情况由下面的
 *    调用方（Inngest 函数）按需要决定，不由这里悄悄决定。
 */
export async function snapshotOneClient(
  due: SnapshotDueData,
  pullMetrics: (clientId: string) => Promise<readonly unknown[]>,
  now: Date = new Date(),
): Promise<SnapshotReceipt> {
  const base = {
    client_id: due.client_id,
    domain: due.domain,
    week_key: due.week_key,
    provider_calls: PROVIDER_CALLS_PER_CLIENT,
    no_publish: true as const,
    created_at: now.toISOString(),
  }
  try {
    const rows = await pullMetrics(due.client_id)
    return { ...base, status: 'completed', metrics_written: rows.length, error: null }
  } catch (err: unknown) {
    return {
      ...base,
      status: 'failed',
      metrics_written: 0,
      error: err instanceof Error ? err.message : 'unknown_error',
    }
  }
}
