/**
 * 「传成片」入口的闸门测试。
 *
 * 三条真闸（前两条是 lecture 路由踩过的真事故，同款防御要在这里独立成立）：
 *   1. 路径穿透 —— `..` 不许过（getPublicUrl 是纯拼串，归一化后能指到别客户目录）
 *   2. 越权 —— 客户 A 的登录不许挂片到客户 B 的内容上
 *   3. 讲课式不许走这条 —— 它的成片是系统做的，手动挂会盖掉做片结果
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  from: vi.fn(),
  getPublicUrl: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  normalizeRecordingLink: vi.fn(),
  looksLikeVideoResponse: vi.fn(),
  safeProbe: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireAccess,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: mocks.from,
    storage: {
      from: () => ({
        getPublicUrl: mocks.getPublicUrl,
        createSignedUploadUrl: mocks.createSignedUploadUrl,
      }),
    },
  },
}))

vi.mock('@/lib/factory/recording-link', () => ({
  normalizeRecordingLink: mocks.normalizeRecordingLink,
  looksLikeVideoResponse: mocks.looksLikeVideoResponse,
}))

// 探活的 SSRF 防护有自己的测试（safe-remote-fetch），这里只关心路由怎么用它的结论
vi.mock('@/lib/factory/safe-remote-fetch', () => ({
  safeProbeRemoteFile: mocks.safeProbe,
}))

import { POST, PATCH } from '../route'

const CLIENT = '377468af-b103-45f0-984a-b353febb56a1'
const POST_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

/**
 * 照真实调用链建假件，两张表都要建模（只建一张 = 测不出真实行为）：
 *   content_posts               .select().eq().eq().maybeSingle()  读
 *                               .update().eq().eq().eq().select()  写（三重限定）
 *   content_factory_render_jobs .select().eq().in().limit()        查活跃做片任务
 *
 * @param row      content_posts 那一行；null = 查不到
 * @param opts.updateHits  写命中几行。0 = status 条件没命中（已排期/已发布）
 * @param opts.activeJobs  有几个在跑的做片任务
 */
function fakeDb(
  row: Record<string, unknown> | null,
  opts: { updateHits?: number; activeJobs?: number } = {},
) {
  const hits = opts.updateHits ?? 1
  const jobs = Array.from({ length: opts.activeJobs ?? 0 }, (_, i) => ({ id: `job-${i}` }))

  const updateSelect = vi.fn().mockResolvedValue({
    data: Array.from({ length: hits }, () => ({ id: 'x' })),
    error: null,
  })
  const updateEq3 = vi.fn(() => ({ select: updateSelect }))
  const updateEq2 = vi.fn(() => ({ eq: updateEq3 }))
  const updateEq1 = vi.fn(() => ({ eq: updateEq2 }))
  const update = vi.fn(() => ({ eq: updateEq1 }))

  const jobsLimit = vi.fn().mockResolvedValue({ data: jobs, error: null })

  mocks.from.mockImplementation((table: string) => {
    if (table === 'content_factory_render_jobs') {
      return {
        select: vi.fn(() => ({ eq: vi.fn(() => ({ in: vi.fn(() => ({ limit: jobsLimit })) })) })),
      }
    }
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) })),
        })),
      })),
      update,
    }
  })
  return { update, updateEq1, updateEq2, updateEq3 }
}

/** 一条正常的、可以挂片的内容 */
const okRow = { id: POST_ID, format: null, status: 'approved', source_video_url: null }

const req = (body: unknown) => ({ json: async () => body }) as never
const params = { params: { id: CLIENT, postId: POST_ID } }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAccess.mockResolvedValue({ ok: true })
  mocks.getPublicUrl.mockReturnValue({ data: { publicUrl: 'https://cdn.example/final.mp4' } })
})

describe('鉴权', () => {
  it('没登录 → 直接挡掉，不碰数据库', async () => {
    mocks.requireAccess.mockResolvedValue({ ok: false, error: '未登录', status: 401 })
    const res = await PATCH(req({ action: 'clear' }), params)
    expect(res.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })
})

describe('🔴 路径穿透', () => {
  const cases = [
    ['..向上跳一层', `${CLIENT}/final/${POST_ID}/../../other/final-1.mp4`],
    ['跳到别客户目录', `other-client/final/${POST_ID}/final-1.mp4`],
    ['跳到别条内容', `${CLIENT}/final/other-post/final-1.mp4`],
    ['文件名不是签出来的格式', `${CLIENT}/final/${POST_ID}/evil.mp4`],
    ['伪装扩展名', `${CLIENT}/final/${POST_ID}/final-1.mp4.exe`],
    ['前缀对但后面接了别的', `${CLIENT}/final/${POST_ID}/final-1.mp4/../x.mp4`],
  ] as const

  for (const [name, path] of cases) {
    it(`拒绝：${name}`, async () => {
      const db = fakeDb(okRow)
      const res = await PATCH(req({ action: 'uploaded', path }), params)
      expect(res.status).toBe(400)
      expect(db.update, '被拒的路径不许写库').not.toHaveBeenCalled()
    })
  }

  it('放行：正是签出来的那种路径', async () => {
    const db = fakeDb(okRow)
    const res = await PATCH(
      req({ action: 'uploaded', path: `${CLIENT}/final/${POST_ID}/final-1755388800000.mp4` }),
      params,
    )
    expect(res.status).toBe(200)
    expect(db.update).toHaveBeenCalledWith({ source_video_url: 'https://cdn.example/final.mp4' })
  })
})

describe('🔴 越权', () => {
  it('内容不属于这个客户 → 404，且不写库', async () => {
    // 双重限定 .eq(client_id).eq(id) 查不到 → maybeSingle 返回 null
    const db = fakeDb(null)
    const res = await PATCH(
      req({ action: 'uploaded', path: `${CLIENT}/final/${POST_ID}/final-1.mp4` }),
      params,
    )
    expect(res.status).toBe(404)
    expect(db.update).not.toHaveBeenCalled()
  })

  it('写库时带了双重限定（client_id + id），不是只按 id 改', async () => {
    const db = fakeDb(okRow)
    await PATCH(
      req({ action: 'uploaded', path: `${CLIENT}/final/${POST_ID}/final-1.mp4` }),
      params,
    )
    expect(db.updateEq1).toHaveBeenCalledWith('client_id', CLIENT)
    expect(db.updateEq2).toHaveBeenCalledWith('id', POST_ID)
    expect(db.updateEq3, '第三重限定 status=approved 必须在 update 里，不能先读后判').toHaveBeenCalledWith('status', 'approved')
  })
})

describe('🔴 讲课式不走这条', () => {
  it('PATCH 挂片被挡', async () => {
    const db = fakeDb({ ...okRow, format: '讲课式' })
    const res = await PATCH(
      req({ action: 'uploaded', path: `${CLIENT}/final/${POST_ID}/final-1.mp4` }),
      params,
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('工作台') })
    expect(db.update, '不许盖掉系统做的成片').not.toHaveBeenCalled()
  })

  it('POST 签上传也被挡', async () => {
    fakeDb({ ...okRow, format: '讲课式' })
    const res = await POST(req({ fileName: 'a.mp4' }), params)
    expect(res.status).toBe(400)
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled()
  })
})

describe('粘链接', () => {
  it('链接打不开 → 400，不写库', async () => {
    const db = fakeDb(okRow)
    mocks.normalizeRecordingLink.mockReturnValue({ ok: true, url: 'https://x/v.mp4' })
    mocks.safeProbe.mockResolvedValue({ ok: false, error: '打不开这个链接 — 确认链接没过期' })
    const res = await PATCH(req({ action: 'link', link: 'https://x/v.mp4' }), params)
    expect(res.status).toBe(400)
    expect(db.update).not.toHaveBeenCalled()
  })

  it('🔴 探活判定指向内网 → 400，不写库（SSRF）', async () => {
    const db = fakeDb(okRow)
    mocks.normalizeRecordingLink.mockReturnValue({ ok: true, url: 'https://evil.example/x.mp4' })
    mocks.safeProbe.mockResolvedValue({ ok: false, error: '这个链接指向内部地址，不能用' })
    const res = await PATCH(req({ action: 'link', link: 'https://evil.example/x.mp4' }), params)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('内部地址') })
    expect(db.update).not.toHaveBeenCalled()
  })

  it('链接指向的不是视频 → 400，不写库', async () => {
    const db = fakeDb(okRow)
    mocks.normalizeRecordingLink.mockReturnValue({ ok: true, url: 'https://x/page' })
    mocks.safeProbe.mockResolvedValue({ ok: true, contentType: 'text/html', finalUrl: 'https://x/page' })
    mocks.looksLikeVideoResponse.mockReturnValue(false)
    const res = await PATCH(req({ action: 'link', link: 'https://x/page' }), params)
    expect(res.status).toBe(400)
    expect(db.update).not.toHaveBeenCalled()
  })

  it('探活通过 → 挂上去（存规范化后的原链接，不存跳转终点）', async () => {
    const db = fakeDb(okRow)
    mocks.normalizeRecordingLink.mockReturnValue({ ok: true, url: 'https://x/v.mp4' })
    // 跳转终点常带一次性签名会过期，落库要落原链接
    mocks.safeProbe.mockResolvedValue({
      ok: true, contentType: 'video/mp4', finalUrl: 'https://cdn.x/signed?token=expires-soon',
    })
    mocks.looksLikeVideoResponse.mockReturnValue(true)
    const res = await PATCH(req({ action: 'link', link: 'https://x/v.mp4' }), params)
    expect(res.status).toBe(200)
    expect(db.update).toHaveBeenCalledWith({ source_video_url: 'https://x/v.mp4' })
  })
})

describe('其它', () => {
  it('clear 能撤掉传错的片', async () => {
    const db = fakeDb({ ...okRow, source_video_url: 'https://old' })
    const res = await PATCH(req({ action: 'clear' }), params)
    expect(res.status).toBe(200)
    expect(db.update).toHaveBeenCalledWith({ source_video_url: null })
  })

  it('不认识的 action → 400', async () => {
    fakeDb(okRow)
    const res = await PATCH(req({ action: 'whatever' }), params)
    expect(res.status).toBe(400)
  })

  it('POST 只签视频扩展名', async () => {
    fakeDb(okRow)
    const res = await POST(req({ fileName: 'notes.pdf' }), params)
    expect(res.status).toBe(400)
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('POST 签出的路径正是 PATCH 那条正则认的格式（两端对得上）', async () => {
    fakeDb(okRow)
    mocks.createSignedUploadUrl.mockImplementation(async (p: string) => ({
      data: { path: p, signedUrl: 'https://up', token: 't' },
      error: null,
    }))
    const res = await POST(req({ fileName: 'my clip.MP4' }), params)
    const { path } = await res.json()
    expect(new RegExp(`^${CLIENT}/final/${POST_ID}/final-\\d+\\.(mp4|mov|m4v|webm)$`).test(path)).toBe(true)
  })
})

describe('🔴 做片流水线在跑时不许挂片', () => {
  it('有活跃做片任务 → 409，不写库（否则会被 render-assemble 静默覆盖）', async () => {
    const db = fakeDb(okRow, { activeJobs: 1 })
    const res = await PATCH(
      req({ action: 'uploaded', path: `${CLIENT}/final/${POST_ID}/final-1.mp4` }),
      params,
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('打回重做') })
    expect(db.update).not.toHaveBeenCalled()
  })

  it('clear 也拦 —— 做片中撤片只会制造更乱的中间态', async () => {
    const db = fakeDb(okRow, { activeJobs: 1 })
    const res = await PATCH(req({ action: 'clear' }), params)
    expect(res.status).toBe(409)
    expect(db.update).not.toHaveBeenCalled()
  })

  it('POST 签上传也拦', async () => {
    fakeDb(okRow, { activeJobs: 1 })
    const res = await POST(req({ fileName: 'a.mp4' }), params)
    expect(res.status).toBe(409)
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('没有活跃任务 → 放行', async () => {
    const db = fakeDb(okRow, { activeJobs: 0 })
    const res = await PATCH(
      req({ action: 'uploaded', path: `${CLIENT}/final/${POST_ID}/final-1.mp4` }),
      params,
    )
    expect(res.status).toBe(200)
    expect(db.update).toHaveBeenCalled()
  })
})

describe('🔴 只有 approved 的内容能改片', () => {
  it('已排期/已发布 → update 条件不命中 → 409', async () => {
    // status 条件写在 update 里，命中 0 行就是「状态已经变了」
    fakeDb({ ...okRow, status: 'scheduled' }, { updateHits: 0 })
    const res = await PATCH(
      req({ action: 'uploaded', path: `${CLIENT}/final/${POST_ID}/final-1.mp4` }),
      params,
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('状态已经变了') })
  })

  it('POST 签上传对非 approved 也拒', async () => {
    fakeDb({ ...okRow, status: 'published' })
    const res = await POST(req({ fileName: 'a.mp4' }), params)
    expect(res.status).toBe(409)
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('clear 命中 0 行也报 409，不假装成功', async () => {
    fakeDb({ ...okRow, source_video_url: 'https://old' }, { updateHits: 0 })
    const res = await PATCH(req({ action: 'clear' }), params)
    expect(res.status).toBe(409)
  })
})
