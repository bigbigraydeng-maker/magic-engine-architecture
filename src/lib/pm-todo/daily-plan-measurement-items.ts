/**
 * 今日待办里的「Facebook 帖子发出去了，但成绩收不回来」。
 *
 * 数据来源：`daily-plan-post-story-resolve` 工作流写进 `cron_run_logs` 的失败记录
 * （job_name = STORY_RESOLVE_JOB_NAME，status = failed）。不单开表 —— 这条信息本来
 * 就是那次运行的产物，照 `pushPaidSignalReviewItems` 同一个套路读。
 *
 * 拉模式：直接查库，事件丢了、进程重启了，待办照样出得来。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-items'
import { STORY_RESOLVE_JOB_NAME } from '@/lib/campaign/daily-plan-publish'

export type DailyPlanMeasurementItemKind = 'daily_plan_post_unmeasured'

const APP_BASE = 'https://app.magicengine.com.au'
const LOOKBACK_DAYS = 7
const MAX_ITEMS = 20

interface ResolveFailureSummary {
  outcome?: unknown
  reason?: unknown
  client_id?: unknown
  date?: unknown
  idempotency_key?: unknown
  photo_id?: unknown
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function howFor(reason: string, clientId: string, photoId: string): { how: string; href: string } {
  if (reason === 'token_unavailable') {
    return {
      how: '这个客户的 Facebook 主页授权读不到了。打开链接 →「平台连接」→ 点一次「连接 Meta」重新授权。授权好了回我一句，我把这条的成绩补上',
      href: `${APP_BASE}/dashboard/clients/${clientId}/settings`,
    }
  }
  return {
    how: `打开链接进这个客户页，在「发到 Facebook」里找到这一天的帖子，点「在 Facebook 上打开」看它是不是真的公开了（照片编号 ${photoId}）。公开了就回我一句「补测 ${photoId}」；已经被删了就不用管`,
    href: `${APP_BASE}/dashboard/clients/${clientId}`,
  }
}

export async function pushDailyPlanMeasurementItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  clientNames: Map<string, { name: string }>,
): Promise<void> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('summary, started_at')
    .eq('job_name', STORY_RESOLVE_JOB_NAME)
    .eq('status', 'failed')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(`cron_run_logs query failed: ${error.message}`)

  const seen = new Set<string>()
  for (const row of (data ?? []) as Array<{ summary?: ResolveFailureSummary | null }>) {
    const s = row.summary ?? {}
    const clientId = str(s.client_id)
    const key = str(s.idempotency_key)
    if (!clientId || !key || seen.has(key)) continue
    seen.add(key)
    if (seen.size > MAX_ITEMS) break

    const clientName = clientNames.get(clientId)?.name ?? '未知客户'
    const date = str(s.date)
    const { how, href } = howFor(str(s.reason), clientId, str(s.photo_id))
    items.push({
      kind: 'daily_plan_post_unmeasured',
      client_id: clientId,
      client_name: clientName,
      what: `${clientName} 计划在 ${date || '某天'} 发的 Facebook 帖子已经交给 Facebook 了，但系统一直拿不到它的帖子编号 —— 这条帖子的点赞、评论、转发不会被自动记下来，后面的「该不该照这个再发」建议也会缺这一条`,
      how,
      href,
    })
  }
}
