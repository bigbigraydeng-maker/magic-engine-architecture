/**
 * 测试用假 store —— **按表建模,并逐条对齐 RPC 的 SQL 语义**(memory 教训:
 * 假件与 SQL 分叉 = 测试全绿生产撒谎)。对齐点:
 * - claim-first 幂等(failed 行允许重试);
 * - 单调守卫(observed_at 旧的不覆盖新行,计入 skippedStale 并回写 run.stats);
 * - mergeable 'unknown' 不覆盖已知值;threads null 留旧值;
 * - unclassified 冲突只更 title;收编只按显式 resolve 名单且只在 full 轮;
 * - markDelivery 对不存在的行静默 no-op(supabase update 0 行不报错);
 * - notProvisioned 开关(模拟表未 apply)。
 */

import type { DeliveryClaim, ProductMapSyncStore } from './store'
import type {
  DeliveryStatus,
  IssueFactRow,
  PrFactRow,
  SyncRunRow,
  UnclassifiedWorkRow,
  WebhookDeliveryRow,
} from './types'
import { NotProvisionedError } from './types'

export class FakeSyncStore implements ProductMapSyncStore {
  readonly prFacts = new Map<number, PrFactRow>()
  readonly issueFacts = new Map<number, IssueFactRow>()
  readonly unclassified = new Map<string, UnclassifiedWorkRow>()
  readonly deliveries = new Map<string, WebhookDeliveryRow>()
  readonly runs: SyncRunRow[] = []
  notProvisioned = false

  private guard(): void {
    if (this.notProvisioned) throw new NotProvisionedError('fake: 表未 apply')
  }

  async claimDelivery(
    deliveryId: string,
    event: string,
    action: string | null,
  ): Promise<DeliveryClaim> {
    this.guard()
    const existing = this.deliveries.get(deliveryId)
    if (existing) return existing.status === 'failed' ? 'retry_failed' : 'duplicate'
    this.deliveries.set(deliveryId, {
      delivery_id: deliveryId,
      event,
      action,
      received_at: new Date().toISOString(),
      status: 'failed',
      error_message: 'claimed, processing',
    })
    return 'claimed'
  }

  async markDelivery(deliveryId: string, status: DeliveryStatus, error?: string): Promise<void> {
    this.guard()
    const row = this.deliveries.get(deliveryId)
    if (!row) return // supabase 对 0 行 update 不报错 —— 语义对齐
    this.deliveries.set(deliveryId, { ...row, status, error_message: error ?? null })
  }

  async commitSync(
    input: Parameters<ProductMapSyncStore['commitSync']>[0],
  ): Promise<{ skippedStale: number }> {
    this.guard()
    let skippedStale = 0
    for (const fact of input.prFacts) {
      const existing = this.prFacts.get(fact.pr_number)
      // 单调守卫:旧数据不覆盖新行(fetch 完成顺序 ≠ 事件顺序)
      if (existing && existing.observed_at >= fact.observed_at) {
        skippedStale++
        continue
      }
      this.prFacts.set(fact.pr_number, {
        ...fact,
        // SQL:unknown 不覆盖已知 mergeable;threads null 留旧值
        mergeable_state:
          fact.mergeable_state === 'unknown' && existing
            ? existing.mergeable_state
            : fact.mergeable_state,
        unresolved_threads: fact.unresolved_threads ?? existing?.unresolved_threads ?? null,
        sync_run_id: input.run.id,
      })
    }
    for (const fact of input.issueFacts) {
      const existing = this.issueFacts.get(fact.issue_number)
      if (existing && existing.observed_at >= fact.observed_at) {
        skippedStale++
        continue
      }
      this.issueFacts.set(fact.issue_number, { ...fact, sync_run_id: input.run.id })
    }
    const now = new Date().toISOString()
    for (const u of input.unclassified) {
      const key = `${u.kind}#${u.number}`
      const existing = this.unclassified.get(key)
      if (existing) {
        // SQL 冲突分支:只更 title / last_seen / resolved_at,不动 url / opened_at
        this.unclassified.set(key, {
          ...existing,
          title: u.title,
          last_seen_at: now,
          resolved_at: null,
        })
      } else {
        this.unclassified.set(key, {
          kind: u.kind,
          number: u.number,
          title: u.title,
          url: u.url,
          opened_at: u.opened_at,
          first_seen_at: now,
          last_seen_at: now,
          resolved_at: null,
        })
      }
    }
    // 收编:只按显式确认名单,只在 full 轮 —— 绝不做「没扫到 = 已收编」的反推
    if (input.mode === 'full') {
      for (const r of input.resolve) {
        const key = `${r.kind}#${r.number}`
        const row = this.unclassified.get(key)
        if (row && row.resolved_at === null) {
          this.unclassified.set(key, { ...row, resolved_at: now })
        }
      }
    }
    // SQL:skippedStale 回写 run.stats(不回写 = 生产台账恒 0)
    this.runs.push({ ...input.run, stats: { ...input.run.stats, skippedStale } })
    return { skippedStale }
  }

  async readPrFacts(): Promise<PrFactRow[]> {
    this.guard()
    return Array.from(this.prFacts.values())
  }

  async readIssueFacts(): Promise<IssueFactRow[]> {
    this.guard()
    return Array.from(this.issueFacts.values())
  }

  async readUnclassified(): Promise<UnclassifiedWorkRow[]> {
    this.guard()
    return Array.from(this.unclassified.values()).filter((r) => r.resolved_at === null)
  }

  async readLatestRun(): Promise<SyncRunRow | null> {
    this.guard()
    return this.runs.length > 0 ? this.runs[this.runs.length - 1] : null
  }

  async lastFullRunStartedAt(): Promise<string | null> {
    this.guard()
    const fulls = this.runs.filter((r) => r.mode === 'full')
    return fulls.length > 0 ? fulls[fulls.length - 1].started_at : null
  }

  async countWebhookErrorRunsSince(sinceIso: string): Promise<number> {
    this.guard()
    return this.runs.filter(
      (r) => r.status === 'error' && r.trigger === 'webhook' && r.started_at >= sinceIso,
    ).length
  }

  async pruneDeliveriesBefore(iso: string): Promise<number> {
    this.guard()
    let n = 0
    for (const [id, row] of Array.from(this.deliveries.entries())) {
      if (row.received_at < iso) {
        this.deliveries.delete(id)
        n++
      }
    }
    return n
  }
}
