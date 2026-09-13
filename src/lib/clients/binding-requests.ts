/**
 * 客户提交、还没被内部员工处理的外部账户绑定请求（读 client_binding_audit）。
 *
 * 单独成文件、Supabase 客户端由调用方传入：每日待办（pm-todo/manual-items.ts）
 * 用自己拿到的客户端跑，不能在 import 时顺带初始化 `@/lib/supabase`
 * （那个模块缺环境变量会直接抛错，把整份待办拖垮）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BindingAuditOutcome, BindingKind } from './binding-audit'

export interface PendingBindingRequest {
  id: string
  client_id: string
  requested_value: string
  actor_email: string
  created_at: string
}

/** 客户提交之后，内部员工对这个客户做过其中任何一个动作，就算「已处理」。 */
const RESOLVING_OUTCOMES: BindingAuditOutcome[] = ['applied', 'request_dismissed']

/** 只看最近这么多天的请求 —— 更老的没人理，多半已线下处理，过期不再提醒。 */
export const PENDING_REQUEST_WINDOW_DAYS = 30

/**
 * 每个客户只看时间上最新的一行：最新是客户提交 → 待处理；最新是 applied /
 * request_dismissed → 已处理。clientIds 省略 = 所有客户。查询出错抛出。
 */
export async function listPendingBindingRequests(
  supabase: SupabaseClient,
  kind: BindingKind,
  now: Date,
  clientIds?: string[],
): Promise<PendingBindingRequest[]> {
  const since = new Date(now.getTime() - PENDING_REQUEST_WINDOW_DAYS * 86_400_000).toISOString()
  let query = supabase
    .from('client_binding_audit')
    .select('id, client_id, requested_value, actor_email, created_at, outcome')
    .eq('binding_kind', kind)
    .in('outcome', ['requested_by_client', ...RESOLVING_OUTCOMES])
    .gte('created_at', since)
  if (clientIds) query = query.in('client_id', clientIds)

  const { data, error } = await query.order('created_at', { ascending: false }).limit(500)
  if (error) throw new Error(error.message)

  const seen = new Set<string>()
  const pending: PendingBindingRequest[] = []
  for (const r of (data ?? []) as Array<PendingBindingRequest & { outcome: BindingAuditOutcome }>) {
    if (seen.has(r.client_id)) continue
    seen.add(r.client_id)
    if (r.outcome === 'requested_by_client' && r.requested_value) {
      pending.push({
        id: r.id,
        client_id: r.client_id,
        requested_value: r.requested_value,
        actor_email: r.actor_email,
        created_at: r.created_at,
      })
    }
  }
  return pending
}
