/**
 * 同步层持久化 —— 接口 + Supabase 实现。
 *
 * 🔴 supabase client 由调用方注入(route 层构造),本文件不 import `@/lib/supabase`
 *    也不在模块顶层初始化 SDK(仓库铁律 7)。
 * 🔴 未 provision 探测:表/RPC 不存在(42P01 / PGRST205 / PGRST202)
 *    → NotProvisionedError,由 route 层决定怎么回(cron 必须报 failed,不许静默绿)。
 * 🔴 落库唯一入口是原子 RPC `product_map_commit_sync_v1`:
 *    单事务写 run + facts + unclassified,**逐行单调守卫**(observed_at 早于
 *    现有行的不写,计入 skipped_stale)—— 治 webhook 互踩和 cron/webhook 互踩。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  DeliveryStatus,
  IssueFactRow,
  PrFactRow,
  SyncMode,
  SyncRunRow,
  SyncStats,
  UnclassifiedWorkRow,
} from './types'
import { NotProvisionedError } from './types'

export type DeliveryClaim = 'claimed' | 'duplicate' | 'retry_failed'

export interface ProductMapSyncStore {
  /**
   * claim-first 幂等:成功插入 = claimed;
   * 冲突且旧行 processed/skipped_duplicate = duplicate(直接 200 skip);
   * 冲突且旧行 failed = retry_failed(允许重新处理 —— GitHub Redeliver 用同一 GUID,
   * 一律判重会把失败事件永久吞掉)。
   */
  claimDelivery(deliveryId: string, event: string, action: string | null): Promise<DeliveryClaim>
  markDelivery(deliveryId: string, status: DeliveryStatus, error?: string): Promise<void>
  commitSync(input: {
    run: Omit<SyncRunRow, 'stats'> & { stats: SyncStats }
    prFacts: readonly Omit<PrFactRow, 'sync_run_id'>[]
    issueFacts: readonly Omit<IssueFactRow, 'sync_run_id'>[]
    unclassified: readonly { kind: 'pr' | 'issue'; number: number; title: string; url: string; opened_at: string }[]
    /**
     * 收编名单(只在 full 轮生效):**逐条被复核确认**「已关闭或已进登记册/带合法标记」
     * 的存量未分类行。绝不做「本轮没扫到 = 已收编」的反推 —— 30 天没动静的 open
     * item 会掉出扫描窗口,被那种反推误消,发现死在台账里。
     */
    resolve: readonly { kind: 'pr' | 'issue'; number: number }[]
    mode: SyncMode
  }): Promise<{ skippedStale: number }>
  readPrFacts(): Promise<PrFactRow[]>
  readIssueFacts(): Promise<IssueFactRow[]>
  readUnclassified(): Promise<UnclassifiedWorkRow[]>
  readLatestRun(): Promise<SyncRunRow | null>
  /** 上一次 full 轮的 started_at(没有则 null)—— webhook error 汇总的窗口起点。 */
  lastFullRunStartedAt(): Promise<string | null>
  /** 只数 trigger='webhook' 的 error runs —— cron/manual 的错误另有去处。 */
  countWebhookErrorRunsSince(sinceIso: string): Promise<number>
  pruneDeliveriesBefore(iso: string): Promise<number>
}

const MISSING_OBJECT_CODES = new Set(['42P01', 'PGRST205', 'PGRST202'])

function throwIfNotProvisioned(error: { code?: string; message?: string } | null): void {
  if (error && MISSING_OBJECT_CODES.has(error.code ?? '')) {
    throw new NotProvisionedError(error.message ?? error.code ?? 'unknown')
  }
}

export class SupabaseSyncStore implements ProductMapSyncStore {
  constructor(private readonly sb: SupabaseClient) {}

  async claimDelivery(
    deliveryId: string,
    event: string,
    action: string | null,
  ): Promise<DeliveryClaim> {
    // GitHub delivery GUID 固定 36 字符;截断保护 PK 不被垃圾头灌巨行(狄仁杰 T3)
    if (deliveryId.length > 200) deliveryId = deliveryId.slice(0, 200)
    const { error } = await this.sb.from('product_map_webhook_deliveries').insert({
      delivery_id: deliveryId,
      event,
      action,
      status: 'failed', // 占坑即 failed;处理成功后 markDelivery 翻成 processed
      error_message: 'claimed, processing',
    })
    if (!error) return 'claimed'
    throwIfNotProvisioned(error)
    if (error.code !== '23505') {
      throw new Error(`delivery 占坑失败:${error.message}`)
    }
    const { data, error: readErr } = await this.sb
      .from('product_map_webhook_deliveries')
      .select('status')
      .eq('delivery_id', deliveryId)
      .maybeSingle<{ status: DeliveryStatus }>()
    if (readErr) throw new Error(`delivery 状态读取失败:${readErr.message}`)
    return data?.status === 'failed' ? 'retry_failed' : 'duplicate'
  }

  async markDelivery(deliveryId: string, status: DeliveryStatus, error?: string): Promise<void> {
    const { error: err } = await this.sb
      .from('product_map_webhook_deliveries')
      .update({ status, error_message: error ?? null })
      .eq('delivery_id', deliveryId)
    if (err) throw new Error(`delivery 标记失败:${err.message}`)
  }

  async commitSync(input: Parameters<ProductMapSyncStore['commitSync']>[0]): Promise<{ skippedStale: number }> {
    const { data, error } = await this.sb.rpc('product_map_commit_sync_v1', {
      p_run: input.run,
      p_pr_facts: input.prFacts,
      p_issue_facts: input.issueFacts,
      p_unclassified: input.unclassified,
      p_mode: input.mode,
      p_resolve: input.resolve,
    })
    throwIfNotProvisioned(error)
    if (error) throw new Error(`同步落库失败:${error.message}`)
    const result = data as { skipped_stale?: number } | null
    return { skippedStale: result?.skipped_stale ?? 0 }
  }

  async readPrFacts(): Promise<PrFactRow[]> {
    const { data, error } = await this.sb.from('product_map_pr_facts').select('*')
    throwIfNotProvisioned(error)
    if (error) throw new Error(`pr_facts 读取失败:${error.message}`)
    return (data ?? []) as PrFactRow[]
  }

  async readIssueFacts(): Promise<IssueFactRow[]> {
    const { data, error } = await this.sb.from('product_map_issue_facts').select('*')
    throwIfNotProvisioned(error)
    if (error) throw new Error(`issue_facts 读取失败:${error.message}`)
    return (data ?? []) as IssueFactRow[]
  }

  async readUnclassified(): Promise<UnclassifiedWorkRow[]> {
    const { data, error } = await this.sb
      .from('product_map_unclassified_work')
      .select('*')
      .is('resolved_at', null)
    throwIfNotProvisioned(error)
    if (error) throw new Error(`unclassified 读取失败:${error.message}`)
    return (data ?? []) as UnclassifiedWorkRow[]
  }

  async readLatestRun(): Promise<SyncRunRow | null> {
    const { data, error } = await this.sb
      .from('product_map_sync_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle<SyncRunRow>()
    throwIfNotProvisioned(error)
    if (error) throw new Error(`sync_runs 读取失败:${error.message}`)
    return data ?? null
  }

  async lastFullRunStartedAt(): Promise<string | null> {
    const { data, error } = await this.sb
      .from('product_map_sync_runs')
      .select('started_at')
      .eq('mode', 'full')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ started_at: string }>()
    throwIfNotProvisioned(error)
    if (error) throw new Error(`full run 查询失败:${error.message}`)
    return data?.started_at ?? null
  }

  async countWebhookErrorRunsSince(sinceIso: string): Promise<number> {
    const { count, error } = await this.sb
      .from('product_map_sync_runs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'error')
      .eq('trigger', 'webhook')
      .gte('started_at', sinceIso)
    throwIfNotProvisioned(error)
    if (error) throw new Error(`error runs 统计失败:${error.message}`)
    return count ?? 0
  }

  async pruneDeliveriesBefore(iso: string): Promise<number> {
    const { data, error } = await this.sb
      .from('product_map_webhook_deliveries')
      .delete()
      .lt('received_at', iso)
      .select('delivery_id')
    throwIfNotProvisioned(error)
    if (error) throw new Error(`deliveries 清理失败:${error.message}`)
    return (data ?? []).length
  }
}
