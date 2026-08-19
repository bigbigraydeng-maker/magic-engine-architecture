/**
 * 广告中枢 v1 原子预算预留 —— 真钱硬顶的唯一判定点。
 *
 * ── 为什么这是判定点，Kernel 的 USD cost cap 不是 ──────────────────────────
 * Kernel 记账用美元、按 run 一次性上限（`spend_cap_per_run_usd`），且
 * `spend_cap_per_period_usd` 目前只存不强制（kernel migration 头注释里明写
 * 「RESERVED · NOT ENFORCED」）。真正拦住"这一批 sandbox 广告加起来别超过
 * NZ$300"的判定，只能在这里：一条纽币记录 + 四态桶 + 单条原子 UPDATE。
 *
 * ── 为什么是可注入的 store 接口，不是直接 import supabaseAdmin ────────────
 * 跟 `kernel/store.ts` 同一个理由：注入让"硬顶判定在并发下到底顶不顶得住"
 * 这件事能在内存里跑真实测试，不用把安全性验证寄托在一个共享的生产库连接上
 * （见 `__tests__/spend-reservations.concurrency.test.ts`）。
 *
 * ── 四态桶语义（Build Control 木桶原则第二轮裁决）──────────────────────────
 *   reserved   —— 已占用但还没真正写到 Meta 的额度
 *   committed  —— Meta 写入确认成功（建成 + 回读校验过）的额度
 *   released   —— 失败但确定没有产生任何外部副作用，退回去的额度
 *   failed_needs_reconcile —— Meta 写入结果不确定，仍然算在硬顶里，
 *                             直到人工核实清楚移去 committed 或 released
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface SpendReservationRow {
  clientId: string
  scopeKey: string
  currency: string
  capAmountNzd: number
  reservedAmountNzd: number
  committedAmountNzd: number
  releasedAmountNzd: number
  failedNeedsReconcileAmountNzd: number
}

export type ReserveOutcome =
  | { ok: true; row: SpendReservationRow }
  | { ok: false; reason: 'over_cost_cap'; row: SpendReservationRow }

export type MutateOutcome =
  | { ok: true; row: SpendReservationRow }
  | { ok: false; reason: 'insufficient_reserved' }

/**
 * 硬顶判定的数据访问层。真实实现调 Postgres RPC（原子 UPDATE，见 migration
 * `20260820000001_me2_ads_spend_reservations_v1.sql`）；测试用内存版验证并发安全。
 */
export interface SpendReservationStore {
  /**
   * 原子预留：第一次调用为 (clientId, scopeKey) 建终身额度记录（cap 只在首次生效），
   * 之后每次调用做「reserved+committed+failed_needs_reconcile+amount <= cap」的
   * 原子检查 —— 检查和写入是同一次操作，不存在两个并发请求都读到"还有余额"的窗口。
   */
  reserve(clientId: string, scopeKey: string, capAmountNzd: number, amountNzd: number): Promise<ReserveOutcome>
  /** reserved → committed：Meta 写入确认成功后调用。 */
  commit(clientId: string, scopeKey: string, amountNzd: number): Promise<MutateOutcome>
  /** reserved → released：确认没有产生任何外部副作用时调用。 */
  release(clientId: string, scopeKey: string, amountNzd: number): Promise<MutateOutcome>
  /** reserved → failed_needs_reconcile：Meta 写入结果不确定时调用，仍计入硬顶。 */
  markNeedsReconcile(clientId: string, scopeKey: string, amountNzd: number): Promise<MutateOutcome>
}

interface RawReservationJsonb {
  client_id: string
  scope_key: string
  currency: string
  cap_amount_nzd: number
  reserved_amount_nzd: number
  committed_amount_nzd: number
  released_amount_nzd: number
  failed_needs_reconcile_amount_nzd: number
}

function toRow(raw: RawReservationJsonb): SpendReservationRow {
  return {
    clientId: raw.client_id,
    scopeKey: raw.scope_key,
    currency: raw.currency,
    capAmountNzd: raw.cap_amount_nzd,
    reservedAmountNzd: raw.reserved_amount_nzd,
    committedAmountNzd: raw.committed_amount_nzd,
    releasedAmountNzd: raw.released_amount_nzd,
    failedNeedsReconcileAmountNzd: raw.failed_needs_reconcile_amount_nzd,
  }
}

function fail(op: string, error: { message?: string } | null): never {
  throw new Error(`spend-reservations.${op} 失败：${error?.message ?? '未知错误'}`)
}

/** 真实实现：调 Postgres RPC。见 migration 里的 ads_reserve_spend_v1 等四个函数。 */
export function createSupabaseSpendReservationStore(sb: SupabaseClient): SpendReservationStore {
  return {
    async reserve(clientId, scopeKey, capAmountNzd, amountNzd) {
      const { data, error } = await sb.rpc('ads_reserve_spend_v1', {
        p_client_id: clientId,
        p_scope_key: scopeKey,
        p_cap_amount_nzd: capAmountNzd,
        p_amount_nzd: amountNzd,
      })
      if (error) fail('reserve', error)
      const result = data as { ok: boolean; reason?: string; row: RawReservationJsonb } | null
      if (!result) fail('reserve', { message: 'RPC 没有返回结果' })
      if (!result.ok) return { ok: false, reason: 'over_cost_cap', row: toRow(result.row) }
      return { ok: true, row: toRow(result.row) }
    },
    async commit(clientId, scopeKey, amountNzd) {
      const { data, error } = await sb.rpc('ads_commit_spend_v1', {
        p_client_id: clientId,
        p_scope_key: scopeKey,
        p_amount_nzd: amountNzd,
      })
      if (error) fail('commit', error)
      const result = data as { ok: boolean; reason?: string; row?: RawReservationJsonb } | null
      if (!result) fail('commit', { message: 'RPC 没有返回结果' })
      if (!result.ok) return { ok: false, reason: 'insufficient_reserved' }
      return { ok: true, row: toRow(result.row as RawReservationJsonb) }
    },
    async release(clientId, scopeKey, amountNzd) {
      const { data, error } = await sb.rpc('ads_release_spend_v1', {
        p_client_id: clientId,
        p_scope_key: scopeKey,
        p_amount_nzd: amountNzd,
      })
      if (error) fail('release', error)
      const result = data as { ok: boolean; reason?: string; row?: RawReservationJsonb } | null
      if (!result) fail('release', { message: 'RPC 没有返回结果' })
      if (!result.ok) return { ok: false, reason: 'insufficient_reserved' }
      return { ok: true, row: toRow(result.row as RawReservationJsonb) }
    },
    async markNeedsReconcile(clientId, scopeKey, amountNzd) {
      const { data, error } = await sb.rpc('ads_mark_needs_reconcile_v1', {
        p_client_id: clientId,
        p_scope_key: scopeKey,
        p_amount_nzd: amountNzd,
      })
      if (error) fail('markNeedsReconcile', error)
      const result = data as { ok: boolean; reason?: string; row?: RawReservationJsonb } | null
      if (!result) fail('markNeedsReconcile', { message: 'RPC 没有返回结果' })
      if (!result.ok) return { ok: false, reason: 'insufficient_reserved' }
      return { ok: true, row: toRow(result.row as RawReservationJsonb) }
    },
  }
}
