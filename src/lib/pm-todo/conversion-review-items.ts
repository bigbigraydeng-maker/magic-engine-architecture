/**
 * 今日待办里的「成交/咨询待核对」（Issue #1397 PR3）。
 *
 * 文案原则（板桥复审的必改项）：
 *   · 不许出现"回写""CAPI""事件"这类内部说法 —— PM 看不懂按下去会发生什么。
 *   · 要说清**按了会怎样、不按会损失什么**，而不只是"有一条待处理"。
 *   · href 直达能动手的那一页，不是 API 地址。
 *
 * 这里是**拉**模式：直接查库里待处理的行，不依赖任何事件送达。
 * 事件丢了、进程崩了，待办照样出得来 —— 管道不许断头。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-items'
import { formatMoney } from '@/lib/conversions/money'

/** 一次最多列这么多，免得某天灌进来几百条把今日待办淹掉。 */
const MAX_ITEMS = 20

type PendingRow = {
  id: string
  client_id: string
  outcome_kind: 'purchase' | 'balance' | 'lead'
  customer_first: string | null
  customer_last: string | null
  amount_minor: number | null
  currency: string | null
  order_ref: string | null
  occurred_at: string
}

type DoubtRow = {
  id: string
  outcome_id: string
  me_sale_outcomes: { client_id: string; customer_first: string | null; order_ref: string | null } | null
}

/** 只露首字母 —— 待办会被截图、会进日志。 */
function shortName(first: string | null, last: string | null): string {
  const f = first?.trim()
  const l = last?.trim()
  if (f) return `${f[0].toUpperCase()}${l ? ` ${l[0].toUpperCase()}.` : ''} 这位客人`
  return '这位客人'
}

function daysAgo(iso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000)
}

export async function pushConversionReviewItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  clientNames: Map<string, { name: string }>,
  now: Date,
): Promise<void> {
  // ── 待核对的成交/咨询 ────────────────────────────────────────────────
  const { data, error } = await supabase
    .from('me_sale_outcomes')
    .select(
      'id, client_id, outcome_kind, customer_first, customer_last, ' +
        'amount_minor, currency, order_ref, occurred_at',
    )
    .eq('review_status', 'pending_review')
    .is('redacted_at', null)
    .order('occurred_at', { ascending: true })
    .limit(MAX_ITEMS)

  if (error) throw new Error(`成交待核对查询失败: ${error.message}`)

  for (const row of (data ?? []) as unknown as PendingRow[]) {
    const clientName = clientNames.get(row.client_id)?.name ?? '客户'
    const who = shortName(row.customer_first, row.customer_last)
    const age = daysAgo(row.occurred_at, now)
    // 广告平台只收 7 天内的 —— 快到期的要显眼，过期的别再催人做无用功。
    const expired = age > 7

    let what: string
    if (row.outcome_kind === 'lead') {
      what =
        `${who}${age === 0 ? '今天' : `${age} 天前`}来问过一次。要把「这是个真实咨询」告诉广告平台吗？` +
        '告诉后，平台会去找更多像他这样会主动来问的人；不告诉，平台只知道谁点了广告，不知道谁真的开口。'
    } else {
      const money = formatMoney(row.amount_minor, row.currency) ?? '一笔款'
      const kindWord = row.outcome_kind === 'balance' ? '付了尾款' : '付了定金'
      what =
        `${who}${kindWord} ${money}${row.order_ref ? `（单号 ${row.order_ref}）` : ''}。` +
        '要把这笔成交告诉广告平台吗？' +
        '告诉后，平台会去找更多像他这样真会掏钱的人，同样的预算能带回更多真客户；' +
        '不告诉，平台会继续找那些爱填表但不付钱的人。'
    }

    if (expired) {
      what += ` ⚠️ 这条已经过去 ${age} 天，广告平台只收 7 天内的 —— 现在告诉它也收不进去了，可以直接选「不发送」。`
    }

    items.push({
      kind: 'conversion_needs_review',
      client_name: clientName,
      client_id: row.client_id,
      what,
      how: expired
        ? '打开页面，在这条上点「不发送」并选原因「超过时限」即可。'
        : '打开页面，看一眼客人和金额对不对，对就点「告诉广告平台」（会再确认一次），不对就点「不发送」并选个原因。',
      // 🔴 必须是绝对网址。相对路径会被 dropBrokenLinks 静默丢掉
      //    （同 `cross_client_leak` 那次事故，见 manual-items.ts:1540）。
      href: `https://app.magicengine.com.au/dashboard/conversions?client=${row.client_id}&focus=${row.id}`,
    })
  }

  // ── 发出去了但不知道对方收没收 ──────────────────────────────────────
  // 这一档程序绝不会自己重发 —— 重发一次就是永久多记一笔成交，撤不回。
  const { data: doubts, error: doubtErr } = await supabase
    .from('me_conversion_writebacks')
    .select('id, outcome_id, me_sale_outcomes(client_id, customer_first, order_ref)')
    .eq('status', 'in_doubt')
    .limit(MAX_ITEMS)

  if (doubtErr) throw new Error(`不确定状态查询失败: ${doubtErr.message}`)

  for (const row of (doubts ?? []) as unknown as DoubtRow[]) {
    const outcome = row.me_sale_outcomes
    if (!outcome) continue
    const clientName = clientNames.get(outcome.client_id)?.name ?? '客户'

    items.push({
      kind: 'conversion_send_in_doubt',
      client_name: clientName,
      client_id: outcome.client_id,
      what:
        `有一笔成交${outcome.order_ref ? `（单号 ${outcome.order_ref}）` : ''}发给广告平台时断线了，` +
        '不确定对方收到没有。系统**不会**自己重发 —— 万一对方其实收到了，重发就等于把同一笔算成两笔，而且撤不回。',
      how:
        '去广告平台后台的事件管理页看一眼这笔在不在：' +
        '在，就点「已确认收到」；不在，就点「重新发送」。',
      // 🔴 必须是绝对网址（见上面同类注释）。
      href: `https://app.magicengine.com.au/dashboard/conversions?client=${outcome.client_id}&status=in_doubt`,
    })
  }
}
