/**
 * Magic Engine 2.0 · Inngest 云端消费者：每周 SEO 快照（PM 2026-09-07 拍板「开」）
 *
 * 两个函数，一个负责派单、一个负责干活：
 *   · `cloud-flywheel-seo-weekly-fanout` —— 每周定时跑一次，查出该扫的客户，
 *     给每人发一张条子，然后**立刻结束**。它自己不打任何 provider、不花钱。
 *   · `cloud-flywheel-seo-snapshot-one` —— 收一张条子干一个客户，出一份回执。
 *
 * 🔴 **为什么定时器挂 Inngest 而不是 Render**：本仓已经被 Render 的「新建服务要有人
 *    进后台点一次 Apply」坑过两次 —— mailbox-sync-hourly 建了一次都没跑过；行业基准
 *    那条干脆是有人在后台手工建的、仓库里查不到。两种失败都不报错。Inngest 的定时器
 *    跟函数一起注册，少一个「有人忘了点」的环节。
 *
 * 🔴 **但它换来了另一个人工步骤，别装作没有**：Render 不是 Vercel，没有自动同步 ——
 *    新增函数或改了触发器之后，必须有人去 Inngest 后台对 `/api/inngest` 这个地址
 *    重新 Sync 一次，新函数才会被认。**没 Sync 的表现是「安静地不跑」**，
 *    跟「一切正常」长得一模一样。所以这条链路同时登记进 CRON_REGISTRY：
 *    真没跑起来时，健康检查会喊「从来没跑过」。
 *
 * 🔴 **一事件一主**：`flywheel/seo.snapshot.due` 是云端专属事件，本机 factory-worker
 *    不监听（见 client.ts 的 WORKER_OWNED_EVENTS，契约测试锁死）。
 *
 * 🔴 **重复触发不会重复付款**：条子的事件 id 是「客户 + ISO 周」，同一周内重复派单
 *    会被 Inngest 按 id 去重。这是防重复付款的第一道；第二道是每客户串行的并发闸。
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { SeoContentAdapter } from '@/lib/flywheel/adapters/SeoContentAdapter'
import { startCronRun } from '@/lib/cron/run-logger'
import {
  FLYWHEEL_SEO_SNAPSHOT_DUE_EVENT,
  FLYWHEEL_SEO_WEEKLY_CRON,
  FLYWHEEL_SEO_WEEKLY_JOB,
  FLYWHEEL_SEO_WEEKLY_TZ,
  isoWeekKey,
  loadSnapshotRoster,
  parseSnapshotDue,
  PROVIDER_CALLS_PER_CLIENT,
  snapshotEventId,
  snapshotOneClient,
  type SnapshotRosterEntry,
} from '@/lib/flywheel/seo-weekly'

/** 派单结果 —— 也是 Inngest 后台里能直接看懂的那份回执。 */
export interface FanOutReceipt {
  readonly job: string
  readonly week_key: string
  readonly status: 'dispatched' | 'roster_failed' | 'roster_empty'
  readonly clients_dispatched: number
  readonly estimated_provider_calls: number
  readonly no_publish: true
  readonly error: string | null
  readonly created_at: string
}

/** 把名单变成一批待发事件。抽出来是为了能直测「发了什么」而不用真发。 */
export function buildSnapshotEvents(
  entries: readonly SnapshotRosterEntry[],
  weekKey: string,
): Array<{ id: string; name: string; data: { client_id: string; domain: string; week_key: string } }> {
  return entries.map((e) => ({
    id: snapshotEventId(e.clientId, weekKey),
    name: FLYWHEEL_SEO_SNAPSHOT_DUE_EVENT,
    data: { client_id: e.clientId, domain: e.domain, week_key: weekKey },
  }))
}

/** 依赖注入版，便于集成测试注入假名单 / 假发送。 */
export function createFlywheelSeoFanOutFunction(deps: {
  loadRoster: typeof loadSnapshotRoster
  supabase: typeof supabaseAdmin
}) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}flywheel-seo-weekly-fanout`,
      name: 'Flywheel SEO weekly: dispatch one snapshot job per client',
      // 派单本身不该并发跑两遍 —— 两遍会发两批条子，虽然事件 id 去重挡得住，
      // 但运行记录会多一条，健康检查看到的数字就不再是真的。
      concurrency: { limit: 1 },
    },
    { cron: `TZ=${FLYWHEEL_SEO_WEEKLY_TZ} ${FLYWHEEL_SEO_WEEKLY_CRON}` },
    async ({ step }): Promise<FanOutReceipt> => {
      const now = new Date()
      const weekKey = isoWeekKey(now)
      const base = {
        job: FLYWHEEL_SEO_WEEKLY_JOB,
        week_key: weekKey,
        no_publish: true as const,
        created_at: now.toISOString(),
      }

      // 运行记录先写 —— 这是健康检查唯一能看到的东西。放在派单之前，
      // 保证「跑起来了但派单炸了」也留得下痕迹。
      const run = await startCronRun(FLYWHEEL_SEO_WEEKLY_JOB)

      const roster = await step.run('load-roster', async () => deps.loadRoster(deps.supabase))

      if (!roster.ok) {
        await run.finish({ failed: 1, error: roster.reason })
        return { ...base, status: 'roster_failed', clients_dispatched: 0, estimated_provider_calls: 0, error: roster.reason }
      }

      const events = buildSnapshotEvents(roster.entries, weekKey)
      if (events.length === 0) {
        await run.finish({ processed: 0, completed: 0, failed: 0, summary: { week_key: weekKey } })
        return { ...base, status: 'roster_empty', clients_dispatched: 0, estimated_provider_calls: 0, error: null }
      }

      await step.sendEvent('dispatch-snapshots', events)

      // 这里是**预估**：实际花了多少以每个客户自己那份回执里的 provider_calls 为准。
      const estimated = events.length * PROVIDER_CALLS_PER_CLIENT
      await run.finish({
        processed: events.length,
        completed: events.length,
        failed: 0,
        summary: { week_key: weekKey, clients_dispatched: events.length, estimated_provider_calls: estimated },
      })
      return { ...base, status: 'dispatched', clients_dispatched: events.length, estimated_provider_calls: estimated, error: null }
    },
  )
}

/** 依赖注入版：便于直接注入假的 pullMetrics，不碰真 provider。 */
export function createFlywheelSeoSnapshotOneFunction(deps: {
  pullMetrics: (clientId: string) => Promise<readonly unknown[]>
}) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}flywheel-seo-snapshot-one`,
      name: 'Flywheel SEO weekly: snapshot one client',
      // 🔴 同一客户串行：配合事件 id 去重构成防重复付款的第二道。
      concurrency: { limit: 1, key: 'event.data.client_id' },
      // 🔴 不重试：这一步里 provider 的钱是**在函数内部**花掉的，失败回执已经如实记下
      //    花了几次。整条重试 = 再付一次钱，换来的只是同一份可能同样失败的数据。
      //    真要补，下周会自然补上；等不及就手动触发。
      retries: 0,
    },
    { event: FLYWHEEL_SEO_SNAPSHOT_DUE_EVENT },
    async ({ event, step }) => {
      const parsed = parseSnapshotDue(event.data)
      if (!parsed.ok) return { kind: 'invalid_payload', reason: parsed.reason }
      const due = parsed.value
      return await step.run(`snapshot-${due.week_key}-${due.client_id}`, async () =>
        snapshotOneClient(due, deps.pullMetrics),
      )
    },
  )
}

/** 生产实例。 */
export const flywheelSeoWeeklyFanOut = createFlywheelSeoFanOutFunction({
  loadRoster: loadSnapshotRoster,
  supabase: supabaseAdmin,
})

export const flywheelSeoSnapshotOne = createFlywheelSeoSnapshotOneFunction({
  pullMetrics: (clientId) => new SeoContentAdapter().pullMetrics(clientId),
})
