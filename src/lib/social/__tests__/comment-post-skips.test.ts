/**
 * 跳过名单：读不了的帖子别每半小时再问一次。
 *
 * 重点验两件事：
 *   ① 缺权限只压一天 —— 人补上权限后必须自己恢复，不能要谁记得回来清标记
 *   ② 列还没上库时（migration 未 apply）降级成空名单，不能把整轮 cron 拖垮
 */

import { describe, it, expect, vi } from 'vitest'
import type { CommentFetchFailure } from '@/lib/meta/comments'
import {
  MAX_SKIPS,
  capSkips,
  isPersistableFailure,
  isStillSkipped,
  loadPostSkips,
  mergeSkip,
  savePostSkips,
  type PostSkip,
} from '../comment-post-skips'

const NOW = new Date('2026-08-15T00:00:00Z')

function failure(over: Partial<CommentFetchFailure> = {}): CommentFetchFailure {
  return { reason: 'object_gone', code: 100, subcode: 33, message: 'does not exist', transient: false, ...over }
}

describe('isPersistableFailure', () => {
  it('缺权限 / 帖子没了 / 端点下线 —— 这三类才值得记住', () => {
    expect(isPersistableFailure(failure({ reason: 'permission_denied' }))).toBe(true)
    expect(isPersistableFailure(failure({ reason: 'object_gone' }))).toBe(true)
    expect(isPersistableFailure(failure({ reason: 'deprecated_object' }))).toBe(true)
  })

  it('🔴 令牌被拒不进名单 —— 那是整个主页的事，记成 149 条帖子级跳过等于换好令牌还要等一天', () => {
    expect(isPersistableFailure(failure({ reason: 'token_invalid' }))).toBe(false)
  })

  it('临时故障不进名单', () => {
    expect(isPersistableFailure(failure({ reason: 'transient', transient: true }))).toBe(false)
  })
})

describe('mergeSkip', () => {
  it('🔴 缺权限只压一天 —— 人补好权限，第二天自己恢复', () => {
    const s = mergeSkip(undefined, 'p1', failure({ reason: 'permission_denied', code: 10 }), NOW)
    expect(s.retry_after).toBe('2026-08-16T00:00:00.000Z')
  })

  it('帖子没了 / 端点下线压一年 —— 实际等于不再问，但不永远钉死', () => {
    expect(mergeSkip(undefined, 'p1', failure({ reason: 'object_gone' }), NOW).retry_after)
      .toBe('2027-08-15T00:00:00.000Z')
    expect(mergeSkip(undefined, 'p1', failure({ reason: 'deprecated_object', code: 12 }), NOW).retry_after)
      .toBe('2027-08-15T00:00:00.000Z')
  })

  it('再次遇到时保留首次时间，其余按这次的来', () => {
    const first = mergeSkip(undefined, 'p1', failure(), new Date('2026-08-01T00:00:00Z'))
    const again = mergeSkip(first, 'p1', failure({ reason: 'permission_denied', code: 10 }), NOW)
    expect(again.first_seen).toBe('2026-08-01T00:00:00.000Z')
    expect(again.last_seen).toBe('2026-08-15T00:00:00.000Z')
    expect(again.reason).toBe('permission_denied')
  })
})

describe('isStillSkipped', () => {
  const skip = mergeSkip(undefined, 'p1', failure({ reason: 'permission_denied' }), NOW)

  it('没到期就跳过', () => {
    expect(isStillSkipped(skip, new Date('2026-08-15T12:00:00Z'))).toBe(true)
  })

  it('到期后重新去问 —— 这就是「补好权限自己恢复」的那一下', () => {
    expect(isStillSkipped(skip, new Date('2026-08-16T00:00:01Z'))).toBe(false)
  })

  it('没记录 / 时间坏了都当作不跳过（宁可多问一次）', () => {
    expect(isStillSkipped(undefined, NOW)).toBe(false)
    expect(isStillSkipped({ ...skip, retry_after: 'not-a-date' }, NOW)).toBe(false)
  })
})

describe('capSkips', () => {
  it('超出上限时丢最久没再遇到的', () => {
    const many: PostSkip[] = Array.from({ length: 5 }, (_, i) => ({
      post_id: `p${i}`,
      reason: 'object_gone',
      code: 100,
      message: 'gone',
      first_seen: NOW.toISOString(),
      last_seen: new Date(NOW.getTime() + i * 1000).toISOString(),
      retry_after: NOW.toISOString(),
    }))
    const kept = capSkips(many, 2).map((s) => s.post_id)
    expect(kept).toEqual(['p4', 'p3'])
  })

  it('没超就原样返回', () => {
    expect(capSkips([], MAX_SKIPS)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 假 supabase 按表建模；认不出的表直接抛。
// ---------------------------------------------------------------------------

function fakeSupabase(opts: { row?: unknown; selectError?: string; updateError?: string; onUpdate?: (v: unknown) => void }) {
  return {
    from(table: string) {
      if (table !== 'social_comment_config') {
        throw new Error(`fake supabase: table '${table}' is not modelled`)
      }
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.maybeSingle = () =>
        Promise.resolve(
          opts.selectError
            ? { data: null, error: { message: opts.selectError } }
            : { data: opts.row ?? null, error: null },
        )
      chain.update = (values: Record<string, unknown>) => {
        opts.onUpdate?.(values.unreadable_post_ids)
        return {
          eq: () =>
            Promise.resolve(opts.updateError ? { error: { message: opts.updateError } } : { error: null }),
        }
      }
      return chain
    },
  } as never
}

describe('loadPostSkips', () => {
  it('读回名单', async () => {
    const row = { unreadable_post_ids: [{ post_id: 'p1', retry_after: NOW.toISOString() }] }
    expect(await loadPostSkips(fakeSupabase({ row }), 'cts')).toHaveLength(1)
  })

  it('🔴 列还没上库（查询报错）时降级成空名单，不抛 —— 不能因为 migration 没 apply 就让整轮 cron 挂掉', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const supabase = fakeSupabase({ selectError: 'column social_comment_config.unreadable_post_ids does not exist' })
    expect(await loadPostSkips(supabase, 'cts')).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('形状对不上的旧数据直接丢掉，不当成跳过记录', async () => {
    const row = { unreadable_post_ids: [{ post_id: 'p1' }, 'garbage', null, { retry_after: 'x' }] }
    expect(await loadPostSkips(fakeSupabase({ row }), 'cts')).toEqual([])
  })

  it('列是空 / 不是数组时当作没有名单', async () => {
    expect(await loadPostSkips(fakeSupabase({ row: {} }), 'cts')).toEqual([])
    expect(await loadPostSkips(fakeSupabase({ row: { unreadable_post_ids: null } }), 'cts')).toEqual([])
  })
})

describe('savePostSkips', () => {
  it('写入时按上限截断', async () => {
    let written: unknown
    const many: PostSkip[] = Array.from({ length: MAX_SKIPS + 10 }, (_, i) => ({
      post_id: `p${i}`,
      reason: 'object_gone',
      code: 100,
      message: 'gone',
      first_seen: NOW.toISOString(),
      last_seen: new Date(NOW.getTime() + i * 1000).toISOString(),
      retry_after: NOW.toISOString(),
    }))
    await savePostSkips(fakeSupabase({ onUpdate: (v) => (written = v) }), 'cts', many)
    expect(Array.isArray(written) && written.length).toBe(MAX_SKIPS)
  })

  it('🔴 写不进去只 warn 不抛 —— 大不了下一轮重新遇到，不能拖垮整轮回复', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(savePostSkips(fakeSupabase({ updateError: 'no such column' }), 'cts', [])).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
