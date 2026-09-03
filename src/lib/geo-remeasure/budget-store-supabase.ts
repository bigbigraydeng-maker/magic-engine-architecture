/**
 * GeoBudgetStore 的 Supabase 实现（#1347）—— 只调 RPC，不自己算余额。
 * 🔴 SDK 客户端在 handler 内注入（CLAUDE.md 铁律 7），不在模块顶层初始化：本文件只接收
 *    已建好的 client。RPC 名 / 参数与 migration `20260904000001_geo_client_budget_ledger_v1.sql` 对齐。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeoBudgetStore, GeoBudgetReserveResult, GeoBudgetSettleResult, GeoBudgetReserveReason } from './budget-ledger'

export function createSupabaseGeoBudgetStore(client: SupabaseClient): GeoBudgetStore {
  return {
    async reserve(clientId, periodKey, worstCaseUsd): Promise<GeoBudgetReserveResult> {
      const { data, error } = await client.rpc('geo_reserve_budget_v1', {
        p_client_id: clientId,
        p_period_key: periodKey,
        p_worst_case_usd: worstCaseUsd,
      })
      // 🔴 RPC 报错 = 未知，一律当拒绝（fail-closed），绝不当授权。
      if (error) return { reserved: false, reason: 'no_budget_row' }
      const d = (data ?? {}) as { reserved?: boolean; reason?: string; remaining_usd?: number }
      return {
        reserved: d.reserved === true,
        reason: d.reason as GeoBudgetReserveReason | undefined,
        remainingUsd: typeof d.remaining_usd === 'number' ? d.remaining_usd : undefined,
      }
    },
    async settle(clientId, periodKey, reservedUsd, actualUsd): Promise<GeoBudgetSettleResult> {
      const { data, error } = await client.rpc('geo_settle_budget_v1', {
        p_client_id: clientId,
        p_period_key: periodKey,
        p_reserved_usd: reservedUsd,
        p_actual_usd: actualUsd,
      })
      if (error) return { settled: false, reason: 'rpc_error' }
      const d = (data ?? {}) as { settled?: boolean; reason?: string; charged_usd?: number }
      return { settled: d.settled === true, reason: d.reason, chargedUsd: d.charged_usd }
    },
  }
}
