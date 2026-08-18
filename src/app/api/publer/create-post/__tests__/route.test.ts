/**
 * P21.J.SEC-2：/api/publer/create-post 至今无鉴权——任何人拿一个 post_id
 * 就能把该客户的成片发到他的社媒账号。这里只守鉴权这道闸本身（route 剩下
 * 的业务逻辑不在这次改动范围内，不在这里补测）。
 *
 * 两条路都要守（Codex 复审 P1 指出漏了第二条）：
 * - webhook：Zapier/Airtable 带 Bearer token，没有登录会话
 * - dashboard：/dashboard/content 页面「批量发布」按钮，走浏览器会话，
 *   不带 Bearer（密钥不能下发给浏览器）——只做 Bearer-only 鉴权会把这条
 *   已经在生产用的功能也一起 401 掉。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireDashboardClientAccess = vi.fn()

const POST_ROW = { id: 'p1', client_id: 'client-a', caption: 'x', script: '', hashtags: '', platforms: ['facebook'], status: 'approved' }

// 通用可链式 builder——这批测试只关心鉴权闸本身，后面的业务逻辑（选素材/选
// Publer 账号）随便停在哪一步都行，只要不是 401/500 就证明鉴权闸放行了。
// 唯一需要真实数据的是 content_posts 的 single()（要读 client_id 给鉴权用）。
function makeBuilder(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    update: () => builder,
    limit: async () => ({ data: [], error: null }),
    single: async () => (table === 'content_posts' ? { data: POST_ROW, error: null } : { data: null, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
  }
  return builder
}
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: (table: string) => makeBuilder(table) },
}))
vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: (...a: unknown[]) => requireDashboardClientAccess(...a),
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
  requireDashboardClientAccess.mockReset().mockResolvedValue({ ok: false, error: 'not logged in', status: 401 })
})

afterAll(() => {
  if (OLD_TOKEN) process.env.PUBLER_CREATE_POST_TOKEN = OLD_TOKEN
  else delete process.env.PUBLER_CREATE_POST_TOKEN
})

describe('POST /api/publer/create-post — webhook 路径（Bearer token）', () => {
  it('token 正确 → 直接放行，不查登录会话', async () => {
    const res = await POST(req({ token: 'correct-secret' }))
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(500)
    expect(requireDashboardClientAccess).not.toHaveBeenCalled()
  })

  it('服务端没配置 PUBLER_CREATE_POST_TOKEN → 500，不是默认放行（不管登录态如何）', async () => {
    delete process.env.PUBLER_CREATE_POST_TOKEN
    requireDashboardClientAccess.mockResolvedValue({ ok: true })
    const res = await POST(req({ token: 'anything' }))
    expect(res.status).toBe(500)
  })
})

describe('POST /api/publer/create-post — dashboard 路径（登录会话兜底，Codex P1 必改）', () => {
  it('🔴 没带 Bearer，但登录用户对这个 post 的客户有权限 → 放行（批量发布按钮不能被这条鉴权挡住）', async () => {
    requireDashboardClientAccess.mockResolvedValue({ ok: true })
    const res = await POST(req({ token: undefined }))
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(500)
    expect(requireDashboardClientAccess).toHaveBeenCalledWith('client-a')
  })

  it('没带 Bearer，登录会话也没权限 → 401', async () => {
    requireDashboardClientAccess.mockResolvedValue({ ok: false, error: 'no access', status: 403 })
    const res = await POST(req({ token: undefined }))
    expect(res.status).toBe(403)
  })

  it('Bearer 是错的（不是没带）→ 照样退回去查登录会话，不是直接拒绝', async () => {
    requireDashboardClientAccess.mockResolvedValue({ ok: true })
    const res = await POST(req({ token: 'wrong-secret' }))
    expect(res.status).not.toBe(401)
    expect(requireDashboardClientAccess).toHaveBeenCalledWith('client-a')
  })

  it('Bearer 错 + 登录会话也没权限 → 401，两条路都没过', async () => {
    requireDashboardClientAccess.mockResolvedValue({ ok: false, error: 'no access', status: 401 })
    const res = await POST(req({ token: 'wrong-secret' }))
    expect(res.status).toBe(401)
  })
})
