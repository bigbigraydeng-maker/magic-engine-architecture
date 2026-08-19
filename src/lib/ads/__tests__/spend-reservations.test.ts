/**
 * `createSupabaseSpendReservationStore` 单测 —— 只验证「JS 层正确调用 RPC、
 * 正确翻译 jsonb ↔ camelCase」，不验证并发安全（那是 concurrency 测试的活，
 * 因为真正的原子性来自 Postgres 单条 UPDATE 语句，JS 层 mock 证明不了）。
 */
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseSpendReservationStore } from '../spend-reservations'

function rawRow(over: Record<string, unknown> = {}) {
  return {
    client_id: 'c-cts',
    scope_key: 'me_sandbox_v1_cts',
    currency: 'NZD',
    cap_amount_nzd: 300,
    reserved_amount_nzd: 20,
    committed_amount_nzd: 0,
    released_amount_nzd: 0,
    failed_needs_reconcile_amount_nzd: 0,
    ...over,
  }
}

function fakeSb(rpcImpl: (name: string, params: unknown) => Promise<{ data: unknown; error: unknown }>) {
  return { rpc: vi.fn(rpcImpl) } as unknown as SupabaseClient
}

describe('createSupabaseSpendReservationStore.reserve', () => {
  it('调用 ads_reserve_spend_v1，参数用 p_ 前缀 snake_case', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, row: rawRow() }, error: null })
    const store = createSupabaseSpendReservationStore({ rpc } as unknown as SupabaseClient)
    await store.reserve('c-cts', 'me_sandbox_v1_cts', 300, 20)
    expect(rpc).toHaveBeenCalledWith('ads_reserve_spend_v1', {
      p_client_id: 'c-cts',
      p_scope_key: 'me_sandbox_v1_cts',
      p_cap_amount_nzd: 300,
      p_amount_nzd: 20,
    })
  })

  it('ok:true → 翻译成 camelCase row', async () => {
    const store = createSupabaseSpendReservationStore(
      fakeSb(async () => ({ data: { ok: true, row: rawRow() }, error: null })),
    )
    const r = await store.reserve('c-cts', 's', 300, 20)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.row.clientId).toBe('c-cts')
      expect(r.row.capAmountNzd).toBe(300)
      expect(r.row.reservedAmountNzd).toBe(20)
    }
  })

  it('ok:false → 翻译成 over_cost_cap，仍带当前状态', async () => {
    const store = createSupabaseSpendReservationStore(
      fakeSb(async () => ({ data: { ok: false, row: rawRow({ reserved_amount_nzd: 300 }) }, error: null })),
    )
    const r = await store.reserve('c-cts', 's', 300, 20)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('over_cost_cap')
      expect(r.row.reservedAmountNzd).toBe(300)
    }
  })

  it('RPC 报错 → 抛错，不静默吞', async () => {
    const store = createSupabaseSpendReservationStore(
      fakeSb(async () => ({ data: null, error: { message: 'connection refused' } })),
    )
    await expect(store.reserve('c-cts', 's', 300, 20)).rejects.toThrow(/connection refused/)
  })

  it('RPC 没报错但也没返回数据 → 抛错，不当成成功', async () => {
    const store = createSupabaseSpendReservationStore(fakeSb(async () => ({ data: null, error: null })))
    await expect(store.reserve('c-cts', 's', 300, 20)).rejects.toThrow(/没有返回结果/)
  })
})

describe('createSupabaseSpendReservationStore.commit/release/markNeedsReconcile', () => {
  it('commit 调用 ads_commit_spend_v1', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, row: rawRow({ committed_amount_nzd: 20 }) }, error: null })
    const store = createSupabaseSpendReservationStore({ rpc } as unknown as SupabaseClient)
    const r = await store.commit('c-cts', 's', 20)
    expect(rpc).toHaveBeenCalledWith('ads_commit_spend_v1', { p_client_id: 'c-cts', p_scope_key: 's', p_amount_nzd: 20 })
    expect(r.ok).toBe(true)
  })

  it('release 调用 ads_release_spend_v1', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, row: rawRow() }, error: null })
    const store = createSupabaseSpendReservationStore({ rpc } as unknown as SupabaseClient)
    await store.release('c-cts', 's', 20)
    expect(rpc).toHaveBeenCalledWith('ads_release_spend_v1', { p_client_id: 'c-cts', p_scope_key: 's', p_amount_nzd: 20 })
  })

  it('markNeedsReconcile 调用 ads_mark_needs_reconcile_v1', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, row: rawRow() }, error: null })
    const store = createSupabaseSpendReservationStore({ rpc } as unknown as SupabaseClient)
    await store.markNeedsReconcile('c-cts', 's', 20)
    expect(rpc).toHaveBeenCalledWith('ads_mark_needs_reconcile_v1', { p_client_id: 'c-cts', p_scope_key: 's', p_amount_nzd: 20 })
  })

  it('insufficient_reserved：commit 超过已预留的额度 → ok:false，不翻译 row', async () => {
    const store = createSupabaseSpendReservationStore(
      fakeSb(async () => ({ data: { ok: false }, error: null })),
    )
    const r = await store.commit('c-cts', 's', 999)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('insufficient_reserved')
  })
})
