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

import { POST, PATCH } from '../route'

const CLIENT = '377468af-b103-45f0-984a-b353febb56a1'
const POST_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

/** 照真实调用链建假件：.select().eq().eq().maybeSingle() 读；.update().eq().eq() 写。 */
function fakeDb(row: Record<string, unknown> | null) {
  const updateEq2 = vi.fn().mockResolvedValue({ error: null })
  const updateEq1 = vi.fn(() => ({ eq: updateEq2 }))
  const update = vi.fn(() => ({ eq: updateEq1 }))
  mocks.from.mockReturnValue({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) })),
      })),
    })),
    update,
  })
  return { update, updateEq1, updateEq2 }
}

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
      const db = fakeDb({ id: POST_ID, format: null, status: 'approved', source_video_url: null })
      const res = await PATCH(req({ action: 'uploaded', path }), params)
      expect(res.status).toBe(400)
      expect(db.update, '被拒的路径不许写库').not.toHaveBeenCalled()
    })
  }

  it('放行：正是签出来的那种路径', async () => {
    const db = fakeDb({ id: POST_ID, format: null, status: 'approved', source_video_url: null })
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
    const db = fakeDb({ id: POST_ID, format: null, status: 'approved', source_video_url: null })
    await PATCH(
      req({ action: 'uploaded', path: `${CLIENT}/final/${POST_ID}/final-1.mp4` }),
      params,
    )
    expect(db.updateEq1).toHaveBeenCalledWith('client_id', CLIENT)
    expect(db.updateEq2).toHaveBeenCalledWith('id', POST_ID)
  })
})

describe('🔴 讲课式不走这条', () => {
  it('PATCH 挂片被挡', async () => {
    const db = fakeDb({ id: POST_ID, format: '讲课式', status: 'approved', source_video_url: null })
    const res = await PATCH(
      req({ action: 'uploaded', path: `${CLIENT}/final/${POST_ID}/final-1.mp4` }),
      params,
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('工作台') })
    expect(db.update, '不许盖掉系统做的成片').not.toHaveBeenCalled()
  })

  it('POST 签上传也被挡', async () => {
    fakeDb({ id: POST_ID, format: '讲课式', status: 'approved', source_video_url: null })
    const res = await POST(req({ fileName: 'a.mp4' }), params)
    expect(res.status).toBe(400)
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled()
  })
})

describe('粘链接', () => {
  it('链接打不开 → 400，不写库', async () => {
    const db = fakeDb({ id: POST_ID, format: null, status: 'approved', source_video_url: null })
    mocks.normalizeRecordingLink.mockReturnValue({ ok: true, url: 'https://x/v.mp4' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))
    const res = await PATCH(req({ action: 'link', link: 'https://x/v.mp4' }), params)
    expect(res.status).toBe(400)
    expect(db.update).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('链接指向的不是视频 → 400，不写库', async () => {
    const db = fakeDb({ id: POST_ID, format: null, status: 'approved', source_video_url: null })
    mocks.normalizeRecordingLink.mockReturnValue({ ok: true, url: 'https://x/page' })
    mocks.looksLikeVideoResponse.mockReturnValue(false)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 206, headers: { get: () => 'text/html' } }),
    )
    const res = await PATCH(req({ action: 'link', link: 'https://x/page' }), params)
    expect(res.status).toBe(400)
    expect(db.update).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('探活通过 → 挂上去', async () => {
    const db = fakeDb({ id: POST_ID, format: null, status: 'approved', source_video_url: null })
    mocks.normalizeRecordingLink.mockReturnValue({ ok: true, url: 'https://x/v.mp4' })
    mocks.looksLikeVideoResponse.mockReturnValue(true)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 206, headers: { get: () => 'video/mp4' } }),
    )
    const res = await PATCH(req({ action: 'link', link: 'https://x/v.mp4' }), params)
    expect(res.status).toBe(200)
    expect(db.update).toHaveBeenCalledWith({ source_video_url: 'https://x/v.mp4' })
    vi.unstubAllGlobals()
  })
})

describe('其它', () => {
  it('clear 能撤掉传错的片', async () => {
    const db = fakeDb({ id: POST_ID, format: null, status: 'approved', source_video_url: 'https://old' })
    const res = await PATCH(req({ action: 'clear' }), params)
    expect(res.status).toBe(200)
    expect(db.update).toHaveBeenCalledWith({ source_video_url: null })
  })

  it('不认识的 action → 400', async () => {
    fakeDb({ id: POST_ID, format: null, status: 'approved', source_video_url: null })
    const res = await PATCH(req({ action: 'whatever' }), params)
    expect(res.status).toBe(400)
  })

  it('POST 只签视频扩展名', async () => {
    fakeDb({ id: POST_ID, format: null, status: 'approved', source_video_url: null })
    const res = await POST(req({ fileName: 'notes.pdf' }), params)
    expect(res.status).toBe(400)
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('POST 签出的路径正是 PATCH 那条正则认的格式（两端对得上）', async () => {
    fakeDb({ id: POST_ID, format: null, status: 'approved', source_video_url: null })
    mocks.createSignedUploadUrl.mockImplementation(async (p: string) => ({
      data: { path: p, signedUrl: 'https://up', token: 't' },
      error: null,
    }))
    const res = await POST(req({ fileName: 'my clip.MP4' }), params)
    const { path } = await res.json()
    expect(new RegExp(`^${CLIENT}/final/${POST_ID}/final-\\d+\\.(mp4|mov|m4v|webm)$`).test(path)).toBe(true)
  })
})
