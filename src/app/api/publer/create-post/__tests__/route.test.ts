/**
 * P21.J.SEC-2 / SECURITY P0 #1149：/api/publer/create-post 至今无鉴权——任何人
 * 拿一个 post_id 就能把该客户的成片发到他的社媒账号。这里守鉴权闸本身 + 证明
 * 未授权请求到不了 Publer write，并回归几道已有的业务闸（approved / 价格闸）。
 *
 * 两条鉴权路都要守（Codex P1）：
 * - webhook：Zapier/Airtable 带 Bearer token，没有登录会话
 * - dashboard：/dashboard/content「批量发布」按钮，走浏览器会话，不带 Bearer
 *
 * 令牌未配置时（Codex P2 / #1149 item 3）：webhook 鉴权 fail closed，但绝不能
 * 把合法的 dashboard 登录会话一起挡掉。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireDashboardClientAccess = vi.fn()
const schedulePost = vi.fn(async (..._a: unknown[]) => ({ job_id: 'x' }))
const uploadMediaFromUrl = vi.fn(async (..._a: unknown[]) => ({}))

let postStatus = 'approved'
let priceVerdict: { blocked: boolean; source?: string } = { blocked: false }

const POST_ROW = () => ({
  id: 'p1', client_id: 'client-a', caption: 'x', script: '', hashtags: '',
  platforms: ['facebook'], status: postStatus,
})

// 通用可链式 builder——这批测试只关心鉴权闸本身和几道回归闸，其余业务逻辑
// （选 Publer 账号等）停在哪一步都行。content_posts 的 single() 要真返回
// client_id（给鉴权用）；visual_assets 的 limit() 返回一个 ready 素材，好让
// 放行的请求能一路走到 Publer write（否则会提前停在 "No ready asset"）。
function makeBuilder(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    update: () => builder,
    limit: async () =>
      table === 'visual_assets'
        ? { data: [{ id: 'a1', storage_url: 'https://cdn/x.jpg', asset_type: 'image', is_final: true, current_version_num: 1 }], error: null }
        : { data: [], error: null },
    single: async () => (table === 'content_posts' ? { data: POST_ROW(), error: null } : { data: null, error: null }),
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
  getAccounts: async () => [{ id: 'acc1', provider: 'facebook' }],
  uploadMediaFromUrl: (...a: unknown[]) => uploadMediaFromUrl(...a),
  schedulePost: (...a: unknown[]) => schedulePost(...a),
}))
vi.mock('@/lib/flywheel/adapters/registry', () => ({ getAdapter: () => ({ execute: async () => {} }) }))
vi.mock('@/lib/flywheel/adapters/SocialContentAdapter', () => ({}))
vi.mock('@/lib/content/price-claim-gate', () => ({
  judgeOutgoingPost: async () => priceVerdict,
  priceGateMessage: () => 'price claim unbacked',
}))

import { POST } from '../route'

const req = (opts: { body?: Record<string, unknown>; token?: string; rawAuth?: string }) => {
  const headers: Record<string, string> = {}
  if (opts.rawAuth !== undefined) headers.authorization = opts.rawAuth
  else if (opts.token !== undefined) headers.authorization = `Bearer ${opts.token}`
  return new NextRequest('http://localhost/api/publer/create-post', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? { post_id: 'p1' }),
  })
}

const SECRET = 'correct-secret-value'
const OLD_TOKEN = process.env.PUBLER_CREATE_POST_TOKEN

beforeEach(() => {
  process.env.PUBLER_CREATE_POST_TOKEN = SECRET
  postStatus = 'approved'
  priceVerdict = { blocked: false }
  schedulePost.mockClear()
  uploadMediaFromUrl.mockClear()
  // 默认无登录会话——各用例按需覆盖。
  requireDashboardClientAccess.mockReset().mockResolvedValue({ ok: false, error: 'not logged in', status: 401 })
})

afterAll(() => {
  if (OLD_TOKEN) process.env.PUBLER_CREATE_POST_TOKEN = OLD_TOKEN
  else delete process.env.PUBLER_CREATE_POST_TOKEN
})

describe('POST /api/publer/create-post — webhook 路径（Bearer token）', () => {
  it('token 正确 → 直接放行，不查登录会话，走到 Publer write', async () => {
    const res = await POST(req({ token: SECRET }))
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(500)
    expect(requireDashboardClientAccess).not.toHaveBeenCalled()
    expect(schedulePost).toHaveBeenCalled()
  })

  it('token 错 + 无登录会话 → 401，且没有触达 Publer write', async () => {
    const res = await POST(req({ token: 'wrong-secret' }))
    expect(res.status).toBe(401)
    expect(schedulePost).not.toHaveBeenCalled()
    expect(uploadMediaFromUrl).not.toHaveBeenCalled()
  })

  it('token 错 + 登录会话有权限 → 退回会话鉴权后放行', async () => {
    requireDashboardClientAccess.mockResolvedValue({ ok: true })
    const res = await POST(req({ token: 'wrong-secret' }))
    expect(res.status).not.toBe(401)
    expect(requireDashboardClientAccess).toHaveBeenCalledWith('client-a')
  })

  it('malformed authorization header（非 Bearer 格式）+ 无会话 → 拒绝', async () => {
    const res = await POST(req({ rawAuth: 'Basic Zm9vOmJhcg==' }))
    expect(res.status).toBe(401)
    expect(schedulePost).not.toHaveBeenCalled()
  })

  it('authorization 只有 "Bearer" 无值 + 无会话 → 拒绝', async () => {
    const res = await POST(req({ rawAuth: 'Bearer' }))
    expect(res.status).toBe(401)
    expect(schedulePost).not.toHaveBeenCalled()
  })
})

describe('POST /api/publer/create-post — 令牌未配置（Codex P2 / #1149 item 3）', () => {
  it('token 未配置 + 无会话 → fail closed（拒绝，且到不了 Publer write）', async () => {
    delete process.env.PUBLER_CREATE_POST_TOKEN
    const res = await POST(req({ token: 'anything' }))
    expect(res.status).toBe(401)
    expect(schedulePost).not.toHaveBeenCalled()
  })

  it('token 未配置 + 授权登录会话 → 会话路径仍可用（不再被 500 挡死）', async () => {
    delete process.env.PUBLER_CREATE_POST_TOKEN
    requireDashboardClientAccess.mockResolvedValue({ ok: true })
    const res = await POST(req({ token: undefined }))
    expect(res.status).not.toBe(500)
    expect(res.status).not.toBe(401)
    expect(requireDashboardClientAccess).toHaveBeenCalledWith('client-a')
    expect(schedulePost).toHaveBeenCalled()
  })
})

describe('POST /api/publer/create-post — dashboard 路径（登录会话兜底）', () => {
  it('没带 Bearer + 登录用户对该客户有权限 → 放行', async () => {
    requireDashboardClientAccess.mockResolvedValue({ ok: true })
    const res = await POST(req({ token: undefined }))
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(500)
    expect(requireDashboardClientAccess).toHaveBeenCalledWith('client-a')
  })

  it('没带 Bearer + 登录用户对 resolved 客户没权限 → 拒绝（光有 post_id 不算授权）', async () => {
    requireDashboardClientAccess.mockResolvedValue({ ok: false, error: 'no access', status: 403 })
    const res = await POST(req({ token: undefined }))
    expect(res.status).toBe(403)
    expect(schedulePost).not.toHaveBeenCalled()
  })

  it('鉴权绑定到 post.client_id，而非调用方传入的值', async () => {
    requireDashboardClientAccess.mockResolvedValue({ ok: true })
    await POST(req({ token: undefined, body: { post_id: 'p1', client_id: 'attacker-client' } }))
    expect(requireDashboardClientAccess).toHaveBeenCalledWith('client-a')
    expect(requireDashboardClientAccess).not.toHaveBeenCalledWith('attacker-client')
  })
})

describe('POST /api/publer/create-post — 已有业务闸回归', () => {
  it('post 非 approved → 400，且不触达 Publer write', async () => {
    postStatus = 'draft'
    const res = await POST(req({ token: SECRET }))
    expect(res.status).toBe(400)
    expect(schedulePost).not.toHaveBeenCalled()
  })

  it('价格闸拦下 → 409，且不触达 Publer write', async () => {
    priceVerdict = { blocked: true, source: 'unbacked' }
    const res = await POST(req({ token: SECRET }))
    expect(res.status).toBe(409)
    expect(schedulePost).not.toHaveBeenCalled()
  })
})

describe('POST /api/publer/create-post — 密钥不外泄', () => {
  it('token 值不出现在任何响应体 / console 日志里', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    // 触发一条会 log 的路径（价格闸拦下会 console.error）
    priceVerdict = { blocked: true, source: 'unbacked' }
    const res = await POST(req({ token: SECRET }))
    const body = await res.text()
    expect(body).not.toContain(SECRET)
    const logged = [...errSpy.mock.calls, ...logSpy.mock.calls].flat().join(' ')
    expect(logged).not.toContain(SECRET)
    errSpy.mockRestore()
    logSpy.mockRestore()
  })
})
