/**
 * SECURITY P0 #1149：/api/publer/create-post 原先无鉴权——任何人拿一个 post_id
 * 就能把该客户的成片发到他的社媒账号。
 *
 * RESCOPE（#1149 comment 5380214929）：docs/STATE.md / docs/DECISIONS.md 记录
 * Zapier/Airtable 自动化链路已完全退役、审核已搬进 ME 驾驶舱，仓库里唯一活跃的
 * 调用方是 dashboard/content 页面的登录态请求。据此撤回 webhook Bearer 旁路。
 *
 * PAID-TIER GATE（#1149 comment 5380438639）：/dashboard/content 页面被 middleware
 * 限定为 paid_client，但 requirePaidClientAccess 放行 self_serve——self_serve
 * 用户能绕过页面闸、直接拿自己客户的 approved post 打这条 API 触发真实发布。故这里
 * 用 requirePaidClientAccess：每个请求都必须是登录态、对该客户有权限、且付费档，
 * 授权绑定到 resolved post.client_id，光有 post_id 不算授权。这里守这道闸，并证明
 * 未登录 / 越租户 / 非付费档（self_serve）的请求到不了 Publer write；再回归几道
 * 已有业务闸（approved / 价格闸）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requirePaidClientAccess = vi.fn()
const schedulePost = vi.fn(async (..._a: unknown[]) => ({ job_id: 'x' }))
const uploadMediaFromUrl = vi.fn(async (..._a: unknown[]) => ({}))

let postStatus = 'approved'
let priceVerdict: { blocked: boolean; source?: string } = { blocked: false }
// post 请求的平台（测「空/无平台」用）
let postPlatforms: unknown = ['facebook']
// 客户 client_connectors 里 publer 那行（null = 没有连接器行）
let connectorRow: { config: unknown } | null = { config: { publer_account_ids: { facebook: 'acc1' } } }
// Publer 当前真实返回的 live 账号列表
let publerAccounts: Array<{ id: string; provider: string }> = [{ id: 'acc1', provider: 'facebook' }]

const POST_ROW = () => ({
  id: 'p1', client_id: 'client-a', caption: 'x', script: '', hashtags: '',
  platforms: postPlatforms, status: postStatus,
})

// 通用可链式 builder。content_posts 的 single() 返回 client_id（给鉴权用）；
// visual_assets 的 limit() 返回一个 ready 素材，好让放行的请求能一路走到账号
// 绑定校验（否则会提前停在 "No ready asset"）；client_connectors 的 maybeSingle()
// 返回可控的 connectorRow（账号绑定 fail-closed 测试的输入）。
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
    maybeSingle: async () => (table === 'client_connectors' ? { data: connectorRow, error: null } : { data: null, error: null }),
  }
  return builder
}
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: (table: string) => makeBuilder(table) },
}))
vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: (...a: unknown[]) => requirePaidClientAccess(...a),
}))
vi.mock('@/lib/publer/client', () => ({
  getAccounts: async () => publerAccounts,
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
  // happy 默认：请求 facebook、连接器显式绑定 facebook→acc1、Publer live 账号含
  // acc1/facebook。账号绑定 fail-closed 用例各自覆盖这三个之一。
  postPlatforms = ['facebook']
  connectorRow = { config: { publer_account_ids: { facebook: 'acc1' } } }
  publerAccounts = [{ id: 'acc1', provider: 'facebook' }]
  schedulePost.mockClear()
  uploadMediaFromUrl.mockClear()
  // 默认无登录会话——各用例按需覆盖。
  requirePaidClientAccess.mockReset().mockResolvedValue({ ok: false, error: 'not logged in', status: 401 })
})

describe('POST /api/publer/create-post — 付费档客户权限闸（每个请求都必须过）', () => {
  it('付费档用户对该客户有权限 → 放行，鉴权绑定 resolved post.client_id，走到 Publer write', async () => {
    requirePaidClientAccess.mockResolvedValue({ ok: true, tier: 'paid_client' })
    const res = await POST(req())
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(500)
    expect(requirePaidClientAccess).toHaveBeenCalledWith('client-a')
    expect(schedulePost).toHaveBeenCalled()
  })

  it('🔴 self_serve 用户（对自己客户有 dashboard 权限但非付费档）→ 403 / paid_only，且到不了 Publer write', async () => {
    // requirePaidClientAccess 对 self_serve 返回结构化 403 reason=paid_only。
    // 这正是 Codex P1：self_serve 能绕过 /dashboard/content 的页面闸直接打 API，
    // 必须在这里拦住，不能触达任何 Publer 写入。
    requirePaidClientAccess.mockResolvedValue({
      ok: false, status: 403, error: 'This feature requires a paid plan.', reason: 'paid_only',
    })
    const res = await POST(req())
    expect(res.status).toBe(403)
    expect((await res.json()).reason).toBe('paid_only')
    expect(requirePaidClientAccess).toHaveBeenCalledWith('client-a')
    expect(uploadMediaFromUrl).not.toHaveBeenCalled()
    expect(schedulePost).not.toHaveBeenCalled()
  })

  it('未登录（无会话）→ 401，且到不了 Publer write（uploadMedia / schedulePost 都没触达）', async () => {
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(uploadMediaFromUrl).not.toHaveBeenCalled()
    expect(schedulePost).not.toHaveBeenCalled()
  })

  it('登录但对 resolved 客户没权限（越租户）→ 拒绝，且不触达 Publer write（光有 post_id 不算授权）', async () => {
    requirePaidClientAccess.mockResolvedValue({ ok: false, error: 'no access', status: 403 })
    const res = await POST(req())
    expect(res.status).toBe(403)
    expect(schedulePost).not.toHaveBeenCalled()
  })

  it('鉴权绑定到 post.client_id，而非调用方 body 传入的值', async () => {
    requirePaidClientAccess.mockResolvedValue({ ok: true })
    await POST(req({ post_id: 'p1', client_id: 'attacker-client' }))
    expect(requirePaidClientAccess).toHaveBeenCalledWith('client-a')
    expect(requirePaidClientAccess).not.toHaveBeenCalledWith('attacker-client')
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
    requirePaidClientAccess.mockResolvedValue({ ok: true })
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

/**
 * #1149 P1（FAIL CLOSED ON CLIENT PUBLISHING ACCOUNT BINDING）：
 * 租户边界必须守到最终外部落点。绝不回退到工作区任意账号 / 第一个匹配平台 /
 * accounts[0]——否则会把本客户内容发到另一个客户的社媒。只发到客户连接器里显式
 * 绑定、且解析成 live 账号、且 provider 匹配的账号；任一环节缺失都在 uploadMedia /
 * schedulePost 之前 fail closed，给不含密钥的配置错误。
 */
describe('POST /api/publer/create-post — 客户发布账号绑定 fail-closed', () => {
  beforeEach(() => {
    // 鉴权 + approved + 价格闸都放行，把测试聚焦在账号绑定这一段。
    requirePaidClientAccess.mockResolvedValue({ ok: true, tier: 'paid_client' })
  })

  const expectNoProviderWrite = () => {
    expect(uploadMediaFromUrl).not.toHaveBeenCalled()
    expect(schedulePost).not.toHaveBeenCalled()
  }

  it('happy：连接器显式绑定 + live 账号 + provider 匹配 → 发到绑定账号', async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(schedulePost).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'acc1', provider: 'facebook' }))
  })

  it('🔴 大小写不敏感：连接器 key 存成 "Facebook"（原始大小写）→ 仍识别为已绑定并发出（#1149 P2）', async () => {
    // settings UI 直接写 Publer 的 provider 字段，key 可能带原始大小写；
    // 请求平台是小写 facebook，必须仍匹配，不能误判成 connector_unbound。
    connectorRow = { config: { publer_account_ids: { Facebook: 'acc1' } } }
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(schedulePost).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'acc1', provider: 'facebook' }))
  })

  it('大小写不敏感 + provider 仍必须匹配：key "Facebook" 绑到一个 instagram 账号 → provider_mismatch，不发', async () => {
    connectorRow = { config: { publer_account_ids: { Facebook: 'acc1' } } }
    publerAccounts = [{ id: 'acc1', provider: 'instagram' }]
    const res = await POST(req())
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('provider_mismatch')
    expectNoProviderWrite()
  })

  it('没有连接器行（connectorRow=null）→ 400 connector_unbound，不触达 Publer write', async () => {
    connectorRow = null
    const res = await POST(req())
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('connector_unbound')
    expectNoProviderWrite()
  })

  it('publer_account_ids 缺失 / 形状错误 → 400 connector_unbound，不触达 Publer write', async () => {
    connectorRow = { config: { publer_account_ids: 'not-an-object' } }
    const res = await POST(req())
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('connector_unbound')
    expectNoProviderWrite()
  })

  it('请求平台未绑定（绑了 instagram，帖子发 facebook）→ 400 connector_unbound，不触达 Publer write', async () => {
    connectorRow = { config: { publer_account_ids: { instagram: 'acc9' } } }
    const res = await POST(req())
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('connector_unbound')
    expectNoProviderWrite()
  })

  it('绑定账号 ID 已失效（不在 live 列表里）→ 400 account_stale，不触达 Publer write', async () => {
    connectorRow = { config: { publer_account_ids: { facebook: 'acc-stale' } } }
    const res = await POST(req())
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('account_stale')
    expectNoProviderWrite()
  })

  it('绑定账号 provider 与请求平台不符 → 400 provider_mismatch，不触达 Publer write', async () => {
    publerAccounts = [{ id: 'acc1', provider: 'instagram' }]
    const res = await POST(req())
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('provider_mismatch')
    expectNoProviderWrite()
  })

  it('帖子没有目标平台（空数组）→ 400 no_platform，不触达 Publer write', async () => {
    postPlatforms = []
    const res = await POST(req())
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('no_platform')
    expectNoProviderWrite()
  })
})
