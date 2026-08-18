/**
 * P21.J.SEC-2：/api/publer/create-post 至今无鉴权——任何人拿一个 post_id
 * 就能把该客户的成片发到他的社媒账号。这里只守鉴权这道闸本身（route 剩下
 * 的业务逻辑不在这次改动范围内，不在这里补测）。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// 鉴权闸之后的依赖全部打空——这些测试只关心请求能不能过第一道闸，
// 不关心业务逻辑（那部分不在这次改动范围）。
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }) },
}))
vi.mock('@/lib/publer/client', () => ({
  getAccounts: async () => [],
  uploadMediaFromUrl: async () => ({}),
  schedulePost: async () => ({ job_id: 'x' }),
}))
vi.mock('@/lib/flywheel/adapters/registry', () => ({ getAdapter: () => ({ execute: async () => {} }) }))
vi.mock('@/lib/flywheel/adapters/SocialContentAdapter', () => ({}))
vi.mock('@/lib/content/price-claim-gate', () => ({
  judgeOutgoingPost: async () => ({ blocked: false }),
  priceGateMessage: () => '',
}))

import { POST } from '../route'

const req = (opts: { body?: Record<string, unknown>; token?: string }) =>
  new NextRequest('http://localhost/api/publer/create-post', {
    method: 'POST',
    headers: opts.token !== undefined ? { authorization: `Bearer ${opts.token}` } : {},
    body: JSON.stringify(opts.body ?? { post_id: 'p1' }),
  })

const OLD_TOKEN = process.env.PUBLER_CREATE_POST_TOKEN

beforeEach(() => {
  process.env.PUBLER_CREATE_POST_TOKEN = 'correct-secret'
})

afterAll(() => {
  if (OLD_TOKEN) process.env.PUBLER_CREATE_POST_TOKEN = OLD_TOKEN
  else delete process.env.PUBLER_CREATE_POST_TOKEN
})

describe('POST /api/publer/create-post — 鉴权（P21.J.SEC-2）', () => {
  it('没带 Authorization header → 401，业务逻辑不执行', async () => {
    const res = await POST(req({ token: undefined }))
    expect(res.status).toBe(401)
  })

  it('token 不对 → 401', async () => {
    const res = await POST(req({ token: 'wrong-secret' }))
    expect(res.status).toBe(401)
  })

  it('服务端没配置 PUBLER_CREATE_POST_TOKEN → 500，不是默认放行', async () => {
    delete process.env.PUBLER_CREATE_POST_TOKEN
    const res = await POST(req({ token: 'anything' }))
    expect(res.status).toBe(500)
  })

  it('token 正确 → 过了鉴权闸，往下走到业务逻辑（不再是 401/500）', async () => {
    const res = await POST(req({ token: 'correct-secret', body: { post_id: 'p1' } }))
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(500)
  })
})
