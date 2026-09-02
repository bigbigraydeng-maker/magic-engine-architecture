/**
 * GET /api/cron/email-reply-digest
 *
 * 每天早上把「客人来信超过一天没人回」的名单发一封汇总信。
 *
 * ## 为什么要有这条任务
 *
 * 判据（`crm/email-reply-due.ts`）和文案（`crm/email-reply-digest.ts`）都已经就位，
 * 但两者都不会自己跑。没有这条 cron，那份名单只存在于「今日待办」里 ——
 * 而今日待办是发给 ME 自己的 PM 的，**真正欠客人一封信的销售看不到它**。
 * 铁律 3 下半：发现不许死在日志里，也不许死在一份收件人不对的清单里。
 *
 * ## 测试期的两条硬约束（PM 2026-09-03 拍板）
 *
 * 1. 主题和正文都带「【测试功能】」—— 收信的是客户的销售，不是 ME 内部人。
 *    一封没打招呼的机器信，轻则被当垃圾，重则让人以为系统在替他们回客人。
 * 2. **收件人一律不配**，退回 ME 自己的信箱（见下面 `recipients: []`）。
 *
 * ## 排班
 *
 * `0 20 * * *` UTC。NZ 是 UTC+12（NZST，冬令时），所以 UTC 20:00 = **次日** NZ 08:00。
 * 夏令时（NZDT，UTC+13，9 月底到 4 月初）期间同一条排班会落在 NZ 09:00 ——
 * 早上第一件事这个位置两季都成立，所以不为夏令时另开一条。见 render.yaml。
 *
 * Auth: Bearer ${CRON_SECRET}，跟其它所有 cron 路由一致。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import { loadActiveClients } from '@/lib/pm-todo/client-roster'
import { findEmailRepliesDue, type ReplyDueItem, type ReplyDueResult } from '@/lib/crm/email-reply-due'
import { sendEmailReplyDigest } from '@/lib/crm/email-reply-digest'
import { loadMailboxRun, type MailboxRunState } from '@/lib/crm/mailbox-run'

export const maxDuration = 300

const JOB_NAME = 'email-reply-digest'

/**
 * 这么多小时内已经发过信了，就不再发第二遍。
 *
 * 🔴 为什么必须有：这条路由每调一次 GET 就按客户各发一封新信，没有任何标记。
 *    运维在 Render 上看到这条任务显示失败（curl 先断开、路由其实跑完了也算），
 *    手动重跑一次 —— 销售同一个早上收到两三封一模一样的「客人在等回复」。
 *    重复的机器信是这一栏被整个忽略的最快方式。
 *
 * 判据是「**发出去过信没有**」而不是「上一趟状态是不是 completed」：
 * 一趟因为邮箱同步不全被记成 failed、但信已经发出去了，重跑照样是重复；
 * 反过来，一封都没发成的那趟，重跑是应该允许的。
 */
const RESEND_GUARD_HOURS = 12

interface ClientOutcome {
  clientId: string
  clientName: string
  items: number
  /** 被上限压掉、没列进信里的条数（今天是 0：这条路由不传上限）。 */
  dropped: number
  /** 这个客户今天的邮箱没同步上时的原因；正常就是 null。 */
  syncStale: string | null
  sent: boolean
  reason?: string
  recipients: string[]
}

/** 上一趟是不是已经把信发出去了。查不出来时按「没发过」办 —— 漏发比重发轻。 */
async function alreadySent(now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - RESEND_GUARD_HOURS * 3_600_000).toISOString()
  const { data } = await supabaseAdmin
    .from('cron_run_logs')
    .select('summary')
    .eq('job_name', JOB_NAME)
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(5)

  return ((data ?? []) as { summary: { sent?: number } | null }[]).some(
    (r) => Number(r.summary?.sent ?? 0) > 0,
  )
}

/**
 * 这个客户今天的邮箱到底同步上没有 —— 没有就说，别让一份不完整的名单
 * 长得跟完整的一模一样（`crm/mailbox-run.ts` 文件头）。
 */
function syncStaleFor(state: MailboxRunState, clientId: string): string | null {
  const wide = wideTroubleOf(state)
  if (wide) return wide
  if (state.kind !== 'ok' || !state.mailbox) return null

  const mine = (state.mailbox.results ?? []).find(
    (r) => r.clientId === clientId && (r.error || r.stoppedEarly),
  )
  return mine ? `这个客户的邮箱没读全：${mine.error ?? mine.stoppedEarly}` : null
}

/** 整趟层面的同步事故 —— 跟哪个客户无关，所有名单一起不可信。 */
function wideTroubleOf(state: MailboxRunState): string | null {
  if (state.kind === 'stuck') return `公司邮箱同步卡住了：${state.hours} 小时没写完`
  if (state.kind !== 'ok' || !state.mailbox) return null
  if (state.mailbox.error) return `公司邮箱同步整趟失败：${state.mailbox.error}`
  if (state.mailbox.mailboxes === 0) return '一个公司邮箱都没连上'
  return null
}

/**
 * 按客户分组 —— 一个客户一封信，绝不把两家的客人名单拼进同一封。
 *
 * 返回数组而不是 Map：本仓 tsconfig 的 target 不允许直接 `for...of` 一个 Map。
 */
function groupByClient(items: ReplyDueItem[]): Array<[string, ReplyDueItem[]]> {
  const byClient = new Map<string, ReplyDueItem[]>()
  for (const item of items) {
    const list = byClient.get(item.clientId) ?? []
    list.push(item)
    byClient.set(item.clientId, list)
  }
  return Array.from(byClient)
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()

  // 幂等闸放在开跑之前 —— 重跑一次不该连运行记录都多插一行。
  if (await alreadySent(now)) {
    return NextResponse.json({ ok: true, skipped: `${RESEND_GUARD_HOURS} 小时内已经发过了` })
  }

  const run = await startCronRun(JOB_NAME)

  const { clients, error } = await loadActiveClients(supabaseAdmin)
  // 客户名单读不出来 ≠ 一个客户都没有 —— 后者是安静的一天，前者是这趟根本没查。
  // 混成一路的话，一次读库失败会显示成「今天没人欠客人信」。
  if (error) {
    await run.finish({ failed: 1, error: `读不出客户名单：${error.message}` })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (clients.size === 0) {
    await run.finish({ processed: 0, completed: 0, failed: 0, summary: { clients: 0 } })
    return NextResponse.json({ ok: true, clients: 0, sent: 0 })
  }

  const ids = Array.from(clients.keys())

  // 🔴 查不出来必须把运行记录收尾 —— 抛出去的话 startCronRun 插的那行会永远停在
  //    「在跑」，健康检查分不清「崩了」和「还在跑」，这条通道会静默死掉。
  let due: ReplyDueResult
  try {
    due = await findEmailRepliesDue(supabaseAdmin, ids, now)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await run.finish({ failed: 1, error: `查不出待回邮件：${message}` })
    return NextResponse.json({ error: message }, { status: 500 })
  }
  const { items, dropped, droppedByClient } = due

  // 邮箱同步哑了的时候，「零封在等」是假的 —— 这封信必须自报家门。
  // 查不出同步状态不该把整趟带崩，但也不能假装同步是好的（记进 summary）。
  const mailboxState = await loadMailboxRun(supabaseAdmin, now).catch((err): MailboxRunState => {
    console.warn('[email-reply-digest] 读不出邮箱同步状态:', err)
    return { kind: 'unknown' }
  })

  const outcomes: ClientOutcome[] = []
  for (const [clientId, list] of groupByClient(items)) {
    const clientName = clients.get(clientId)?.name ?? '未知客户'
    const syncStale = syncStaleFor(mailboxState, clientId)
    const result = await sendEmailReplyDigest(clientName, list, {
      now,
      // 名单之外还有几封、这份名单完不完整 —— 两条都得跟着信一起出去。
      dropped: droppedByClient[clientId] ?? 0,
      syncStale: syncStale !== null,
      /**
       * 🔴 **测试期故意传空** → `sendEmailReplyDigest` 退回 ME 自己的信箱。
       *
       * 收件人应该是这个客户的销售（CTS 是 Lisa / Baker），但在功能自己证明
       * 判得准之前，一封发错的信会把某个客户的客人名单送到不该看的人手里。
       * **测试通过后由 PM 决定再配上销售的地址**（那时候把地址读进来传这里，
       * 别在这个文件里写死任何人的邮箱）。
       */
      recipients: [],
    })
    outcomes.push({
      clientId,
      clientName,
      items: list.length,
      dropped: droppedByClient[clientId] ?? 0,
      syncStale,
      sent: result.sent,
      reason: result.reason,
      recipients: result.recipients,
    })
  }

  const sent = outcomes.filter((o) => o.sent).length
  const failed = outcomes.length - sent

  // 🔴 「今天信没进来」不许记成健康的一趟。整趟层面的同步事故（卡死 / 整趟失败 /
  //    一个邮箱都没连上）会让这份名单整体不可信 —— 记成 completed 的话，
  //    这条通道哑掉的那天在监控上跟正常那天长得一模一样。
  const wideTrouble = wideTroubleOf(mailboxState)

  await run.finish({
    processed: outcomes.length,
    completed: sent,
    failed: failed + (wideTrouble ? 1 : 0),
    // 发失败不算整趟失败：名单本身查出来了，下一轮还会再发一次。
    // 但 failed 数字必须如实写，不然「一封都没发出去」会显示成健康。
    error: wideTrouble ? `名单不完整：${wideTrouble}` : undefined,
    summary: {
      clients: ids.length,
      threads: items.length,
      dropped,
      // 幂等闸读的就是这个数字（见 `alreadySent`）—— 改名前先看那边。
      sent,
      mailboxState: mailboxState.kind,
      outcomes,
    },
  })

  return NextResponse.json({
    ok: true,
    clients: ids.length,
    items: items.length,
    dropped,
    sent,
    mailboxState: mailboxState.kind,
    outcomes,
  })
}
