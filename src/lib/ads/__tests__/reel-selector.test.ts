/**
 * reel-selector 薄封装的测试。守两条：
 *   1. 排序/打分是 page-posts.ts 原样产出的，这里没有重新计算
 *   2. objectStoryId 是 fullId（pageId_postId），不是裸 postId
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { listBoostCandidates } from '../reel-selector'

function rawPost(over: Record<string, unknown> = {}) {
  return {
    id: '1234567890_111',
    message: 'Great Reel about China tours',
    created_time: new Date().toISOString(),
    attachments: { data: [{ media_type: 'video' }] },
    reactions: { summary: { total_count: 20 } },
    comments: { summary: { total_count: 5 } },
    shares: { count: 3 },
    ...over,
  }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('listBoostCandidates', () => {
  it('objectStoryId 是完整的 pageId_postId 形式', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [rawPost()] }),
    }) as Response))
    const candidates = await listBoostCandidates('1234567890', 'tok')
    expect(candidates).toHaveLength(1)
    expect(candidates[0].objectStoryId).toBe('1234567890_111')
  })

  it('非视频帖子不进候选（rankVideoWinners 过滤，未被本文件改动）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [rawPost({ attachments: { data: [{ media_type: 'photo' }] } })] }),
    }) as Response))
    const candidates = await listBoostCandidates('1234567890', 'tok')
    expect(candidates).toHaveLength(0)
  })

  it('按分数降序排列（分数计算完全来自 page-posts.ts 的 scorePost）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          rawPost({ id: '1_low', reactions: { summary: { total_count: 1 } } }),
          rawPost({ id: '1_high', reactions: { summary: { total_count: 100 } } }),
        ],
      }),
    }) as Response))
    const candidates = await listBoostCandidates('1', 'tok')
    expect(candidates[0].objectStoryId).toBe('1_high')
    expect(candidates[0].score).toBeGreaterThan(candidates[1].score)
  })

  it('minScore 过滤低分候选', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [rawPost({ reactions: { summary: { total_count: 0 } }, comments: { summary: { total_count: 0 } }, shares: { count: 0 } })] }),
    }) as Response))
    const candidates = await listBoostCandidates('1', 'tok', { minScore: 1 })
    expect(candidates).toHaveLength(0)
  })

  it('黑名单关键词过滤', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [rawPost({ message: 'promo spam content' })] }),
    }) as Response))
    const candidates = await listBoostCandidates('1', 'tok', { blacklistKeywords: ['spam'] })
    expect(candidates).toHaveLength(0)
  })

  it('候选带完整证据（reactions/comments/shares/message），不是只有 id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [rawPost()] }),
    }) as Response))
    const candidates = await listBoostCandidates('1234567890', 'tok')
    expect(candidates[0]).toMatchObject({
      reactions: 20, comments: 5, shares: 3, message: 'Great Reel about China tours',
    })
  })
})
