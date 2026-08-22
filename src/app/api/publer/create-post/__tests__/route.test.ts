/**
 * SECURITY P0 #1149：/api/publer/create-post 原先无鉴权——任何人拿一个 post_id
 * 就能把该客户的成片发到他的社媒账号。
 *
 * RESCOPE（#1149 comment 5380214929）：docs/STATE.md / docs/DECISIONS.md 记录
 * Zapier/Airtable 自动化链路已完全退役、审核已搬进 ME 驾驶舱，仓库里唯一活跃的
 * 调用方是 dashboard/content 页面的登录态请求。据此撤回 webhook Bearer 旁路，
 * 收窄为：**每个请求都必须走 dashboard 客户权限校验**，授权绑定到 resolved
 * post.client_id，光有 post_id 不算授权。这里守这道闸，并证明未登录 / 越租户的
 * 请求到不了 Publer write；再回归几道已有业务闸（approved / 价格闸）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

const req = (body: Record<string, unknown> = { post_id: 'p1' }) =>
  new NextRequest('http://localhost/api/publer/create-post', {
    method: 'POST',
    headers: {},
    body: JSON.stringify(body),
  })

beforeEach(() => {
  postStatus = 'approved'
  priceVerdict = { blocked: false }
  schedulePost.mockClear()
  uploadMediaFromUrl.mockClear()
  // 默认无登录会话——各用例按需覆盖。
  requireDashboardClientAccess.mockReset().mockResolvedValue({ ok: false, error: 'not logged in', status: 401 })
})

describe('POST /api/publer/create-post — dashboard 客户权限闸（每个请求都必须过）', () => {
  it('登录用户对该客户有权限 → 放行，鉴权绑定 resolved post.client_id，走到 Publer write', async () => {
    requireDashboardClientAccess.mockResolvedValue({ ok: true })
    const res = await POST(req())
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(500)
    expect(requireDashboardClientAccess).toHaveBeenCalledWith('client-a')
    expect(schedulePost).toHaveBeenCalled()
  })

  it('未登录（无会话）→ 401，且到不了 Publer write（uploadMedia / schedulePost 都没触达）', async () => {
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(uploadMediaFromUrl).not.toHaveBeenCalled()
    expect(schedulePost).not.toHaveBeenCalled()
  })

  it('登录但对 resolved 客户没权限（越租户）→ 拒绝，且不触达 Publer write（光有 post_id 不算授权）', async () => {
    requireDashboardClientAccess.mockResolvedValue({ ok: false, error: 'no access', status: 403 })
    const res = await POST(req())
    expect(res.status).toBe(403)
    expect(schedulePost).not.toHaveBeenCalled()
  })

  it('鉴权绑定到 post.client_id，而非调用方 body 传入的值', async () => {
    requireDashboardClientAccess.mockResolvedValue({ ok: true })
    await POST(req({ post_id: 'p1', client_id: 'attacker-client' }))
    expect(requireDashboardClientAccess).toHaveBeenCalledWith('client-a')
    expect(requireDashboardClientAccess).not.toHaveBeenCalledWith('attacker-client')
  })

  it('鉴权在 approved 闸之前——未登录 + 非 approved 仍是 401，不触达 Publer write', async () => {
    postStatus = 'draft'
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(schedulePost).not.toHaveBeenCalled()
  })

  it('post_id 缺失 → 400', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/publer/create-post — 已有业务闸回归（放行后仍守）', () => {
  beforeEach(() => {
    requireDashboardClientAccess.mockResolvedValue({ ok: true })
  })

  it('post 非 approved → 400，且不触达 Publer write', async () => {
    postStatus = 'draft'
    const res = await POST(req())
    expect(res.status).toBe(400)
    expect(schedulePost).not.toHaveBeenCalled()
  })

  it('价格闸拦下 → 409，且不触达 Publer write', async () => {
    priceVerdict = { blocked: true, source: 'unbacked' }
    const res = await POST(req())
    expect(res.status).toBe(409)
    expect(schedulePost).not.toHaveBeenCalled()
  })
})
