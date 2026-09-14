/**
 * POST /api/admin/conversions/ai-auto-review-run 测试。
 * 这一层只是个薄封装（鉴权 + 决定跑哪些客户 + 汇总结果），核心逻辑在
 * `ai-auto-review-run.ts` 里已经测过，这里不重复断言状态机细节。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-admin', () => ({
  guardAdmin: vi.fn(async () => null),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/conversions/ai-auto-review-run', () => ({
  runAiAutoReviewForClient: vi.fn(async () => ({ ran: true, processed: 0, approved: 0, rejected: 0, uncertain: 0, expired: 0, items: [] })),
}))

import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'
import { runAiAutoReviewForClient } from '@/lib/conversions/ai-auto-review-run'
import { POST } from './route'

function req(body: unknown) {
  return new Request('http://localhost/api/admin/conversions/ai-auto-review-run', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.mocked(guardAdmin).mockClear()
  vi.mocked(runAiAutoReviewForClient).mockClear()
  vi.mocked(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReset()
})

describe('POST ai-auto-review-run', () => {
  it('传了 clientId → 只跑这一个客户', async () => {
    const res = await POST(req({ clientId: 'c1' }))
    const body = await res.json()
    expect(runAiAutoReviewForClient).toHaveBeenCalledTimes(1)
    expect(runAiAutoReviewForClient).toHaveBeenCalledWith('c1', expect.anything())
    expect(body.results.c1).toMatchObject({ ran: true })
  })

  it('没传 clientId → 跑所有开了 ai_auto_review_enabled 的客户', async () => {
    ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [{ id: 'c1' }, { id: 'c2' }], error: null }),
      }),
    }))
    const res = await POST(req({}))
    const body = await res.json()
    expect(runAiAutoReviewForClient).toHaveBeenCalledTimes(2)
    expect(Object.keys(body.results).sort()).toEqual(['c1', 'c2'])
  })

  it('某个客户跑的时候抛错 → 那个客户记为 error，不影响其它客户', async () => {
    ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [{ id: 'c1' }, { id: 'c2' }], error: null }),
      }),
    }))
    vi.mocked(runAiAutoReviewForClient).mockImplementation(async (id: string) => {
      if (id === 'c1') throw new Error('模拟故障')
      return { ran: true, processed: 0, approved: 0, rejected: 0, uncertain: 0, expired: 0, items: [] }
    })
    const res = await POST(req({}))
    const body = await res.json()
    expect(body.results.c1).toMatchObject({ ran: false, reason: 'error' })
    expect(body.results.c2).toMatchObject({ ran: true })
  })
})
