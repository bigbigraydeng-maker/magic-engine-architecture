/**
 * 今日待办里的「AI 客服回复」三档提醒(issue #1589)：
 *   · 待批准草稿 —— AI 写好了，等人点头
 *   · 已批但发送失败 —— 人已经点头了，但客户没收到（P0，H16）
 *   · 超时升级 —— 4 小时没人批，不能拖到明天再看（next-day escalation）
 *
 * 三档共用同一张表 `conversation_reply_drafts`，一次查询按 `verifier_status`
 * 分桶，不三次往返数据库（合法取值见
 * `supabase/migrations/20260913095601_conversation_reply_drafts.sql`）。
 *
 * 拉模式：直接查表，不依赖任何事件送达——Inngest 事件丢了、进程崩了，
 * 待办照样出得来。`superseded_by_draft_id is null` 排除已经被新草稿取代的
 * 旧行，避免同一次对话被算两遍。
 *
 * 门户目前还没有「逐条批准草稿」的专门页面（issue #1588 待建），href 先指向
 * 客户消息页，人工进对话里核对；#1588 上线后这里的 href 要改成直达草稿卡片。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-items'
import type { ClientRow } from './client-roster'

const APP_BASE = 'https://app.magicengine.com.au'

const TRACKED_STATUSES = ['pending', 'send_failed', 'timed_out'] as const
type TrackedStatus = (typeof TRACKED_STATUSES)[number]

type DraftRow = {
  client_id: string
  verifier_status: string
  created_at: string
}

type Bucket = { count: number; oldestIso: string }

function hoursAgo(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 3_600_000))
}

function hrefFor(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${clientId}/messenger`
}

export async function pushMessengerDraftItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  clients: Map<string, ClientRow>,
  now: Date,
): Promise<void> {
  const { data, error } = await supabase
    .from('conversation_reply_drafts')
    .select('client_id, verifier_status, created_at')
    .in('verifier_status', [...TRACKED_STATUSES])
    .is('superseded_by_draft_id', null)
    .limit(2000)

  if (error) throw new Error(`AI 客服草稿查询失败: ${error.message}`)

  const buckets: Record<TrackedStatus, Map<string, Bucket>> = {
    pending: new Map(),
    send_failed: new Map(),
    timed_out: new Map(),
  }

  for (const row of (data ?? []) as DraftRow[]) {
    const bucket = buckets[row.verifier_status as TrackedStatus]
    if (!bucket) continue
    const cur = bucket.get(row.client_id)
    if (!cur || row.created_at < cur.oldestIso) {
      bucket.set(row.client_id, { count: (cur?.count ?? 0) + 1, oldestIso: row.created_at })
    } else {
      cur.count += 1
    }
  }

  const nameOf = (clientId: string) => clients.get(clientId)?.name ?? '未知客户'

  for (const [clientId, agg] of Array.from(buckets.pending.entries())) {
    const name = nameOf(clientId)
    items.push({
      kind: 'messenger_draft_pending_approval',
      client_id: clientId,
      client_name: name,
      what: `${name} 有 ${agg.count} 条 AI 客服回复草稿等你批准，最早一条已经等了 ${hoursAgo(agg.oldestIso, now)} 小时，客户还没收到回复`,
      how: '打开客户消息页，找到对应的对话，看草稿内容对不对，对的话人工把这段话回复过去（逐条批准的按钮还在建，见 #1588）',
      href: hrefFor(clientId),
    })
  }

  for (const [clientId, agg] of Array.from(buckets.send_failed.entries())) {
    const name = nameOf(clientId)
    items.push({
      kind: 'messenger_draft_send_failed',
      client_id: clientId,
      client_name: name,
      what: `${name} 有 ${agg.count} 条 AI 客服回复已经批准，但发送失败了——客户没收到回复，这条最优先处理`,
      how: '打开客户消息页看看这段对话卡在哪（可能是连接掉线，或者客户拉黑了我们），需要人工把这条回复发出去',
      href: hrefFor(clientId),
    })
  }

  for (const [clientId, agg] of Array.from(buckets.timed_out.entries())) {
    const name = nameOf(clientId)
    items.push({
      kind: 'messenger_draft_escalation',
      client_id: clientId,
      client_name: name,
      what: `${name} 有 ${agg.count} 条 AI 客服回复草稿超过 4 小时没人批准，客户还在等回复，不能拖到明天`,
      how: '今天之内打开客户消息页把这些对话处理完，该回的人工回过去',
      href: hrefFor(clientId),
    })
  }
}
