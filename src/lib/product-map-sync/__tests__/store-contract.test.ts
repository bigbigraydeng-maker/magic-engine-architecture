/**
 * 真件 SupabaseSyncStore 的合同测试(stub client,零网络零真库)——
 * 锁三样只有真件才有的东西:RPC 参数名与 SQL 签名对应、claim-first 的
 * 23505 分流、MISSING_OBJECT_CODES → NotProvisionedError。
 * (webhook 路由测试把整个类 mock 掉了,这些分支不在那边的射程内。)
 */

import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SupabaseSyncStore } from '../store'
import { EMPTY_SYNC_STATS, NotProvisionedError } from '../types'

function commitInput() {
  return {
    run: {
      id: 'r1',
      trigger: 'manual' as const,
      mode: 'full' as const,
      status: 'ok' as const,
      main_head_sha: null,
      started_at: '2026-08-15T00:00:00Z',
      finished_at: '2026-08-15T00:01:00Z',
      stats: EMPTY_SYNC_STATS,
      error_message: null,
    },
    prFacts: [],
    issueFacts: [],
    unclassified: [],
    resolve: [],
    mode: 'full' as const,
  }
}

describe('SupabaseSyncStore 合同', () => {
  it('commitSync 的 RPC 名与参数键 = SQL 函数签名(改一边必须改另一边)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { skipped_stale: 2 }, error: null })
    const store = new SupabaseSyncStore({ rpc } as unknown as SupabaseClient)
    const result = await store.commitSync(commitInput())
    expect(result.skippedStale).toBe(2)
    expect(rpc).toHaveBeenCalledWith('product_map_commit_sync_v1', {
      p_run: expect.anything(),
      p_pr_facts: [],
      p_issue_facts: [],
      p_unclassified: [],
      p_mode: 'full',
      p_resolve: [],
    })
  })

  it('RPC 不存在(PGRST202)→ NotProvisionedError', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'fn missing' } })
    const store = new SupabaseSyncStore({ rpc } as unknown as SupabaseClient)
    await expect(store.commitSync(commitInput())).rejects.toBeInstanceOf(NotProvisionedError)
  })

  it('claimDelivery:插入成功 = claimed;23505 冲突读旧行分流;42P01 = 未 provision', async () => {
    const rows: Record<string, { status: string }> = { 'g-dup': { status: 'processed' }, 'g-fail': { status: 'failed' } }
    const makeSb = (insertError: { code: string; message: string } | null) =>
      ({
        from: () => ({
          insert: vi.fn().mockResolvedValue({ error: insertError }),
          select: () => ({
            eq: (_c: string, id: string) => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: rows[id] ?? null, error: null }),
            }),
          }),
        }),
      }) as unknown as SupabaseClient

    expect(await new SupabaseSyncStore(makeSb(null)).claimDelivery('g-new', 'push', null)).toBe('claimed')
    expect(
      await new SupabaseSyncStore(makeSb({ code: '23505', message: 'dup' })).claimDelivery('g-dup', 'push', null),
    ).toBe('duplicate')
    expect(
      await new SupabaseSyncStore(makeSb({ code: '23505', message: 'dup' })).claimDelivery('g-fail', 'push', null),
    ).toBe('retry_failed')
    await expect(
      new SupabaseSyncStore(makeSb({ code: '42P01', message: 'no table' })).claimDelivery('g-x', 'push', null),
    ).rejects.toBeInstanceOf(NotProvisionedError)
  })
})
