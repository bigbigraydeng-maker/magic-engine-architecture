/**
 * SSRF 防护测试。
 *
 * 要防的事：有后台权限的人提交一个公开 HTTPS 地址，让它 302 到
 * `http://169.254.169.254/`（云元数据）或内网，服务器替他去访问。
 * 只校验初始 URL 是不够的 —— 每一跳都要重新查。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('dns/promises', () => ({ lookup: mocks.lookup, default: { lookup: mocks.lookup } }))

import { isBlockedAddress, safeProbeRemoteFile } from '../safe-remote-fetch'

describe('isBlockedAddress —— 私网/保留段一律拦', () => {
  const blocked = [
    ['云元数据服务', '169.254.169.254'],
    ['链路本地', '169.254.1.1'],
    ['10/8 内网', '10.0.0.1'],
    ['172.16/12 内网', '172.16.5.4'],
    ['172.31 仍在段内', '172.31.255.255'],
    ['192.168 内网', '192.168.1.1'],
    ['环回', '127.0.0.1'],
    ['0.0.0.0/8', '0.0.0.0'],
    ['CGNAT', '100.64.0.1'],
    ['组播', '239.1.1.1'],
    ['IPv6 环回', '::1'],
    ['IPv6 链路本地', 'fe80::1'],
    ['IPv6 唯一本地 fc', 'fc00::1'],
    ['IPv6 唯一本地 fd', 'fd12:3456::1'],
    ['🔴 IPv4-mapped 绕过尝试', '::ffff:169.254.169.254'],
    ['🔴 IPv4-mapped 内网', '::ffff:10.0.0.1'],
    ['解析不出来的垃圾', 'not-an-ip'],
  ] as const
  for (const [name, ip] of blocked) {
    it(`拦：${name} (${ip})`, () => expect(isBlockedAddress(ip)).toBe(true))
  }

  const allowed = [
    ['公网 v4', '8.8.8.8'],
    ['公网 v4 边界', '172.15.0.1'],
    ['公网 v4 边界2', '172.32.0.1'],
    ['公网 v4 类 192', '192.167.1.1'],
    ['公网 v6', '2606:4700:4700::1111'],
  ] as const
  for (const [name, ip] of allowed) {
    it(`放行：${name} (${ip})`, () => expect(isBlockedAddress(ip)).toBe(false))
  }
})

describe('safeProbeRemoteFile —— 逐跳校验', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.lookup.mockResolvedValue([{ address: '8.8.8.8' }])
  })
  afterEach(() => vi.unstubAllGlobals())

  it('非 http(s) 协议直接拒', async () => {
    const r = await safeProbeRemoteFile('file:///etc/passwd')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('协议')
  })

  it('初始域名就解析到内网 → 拒，且一次网络请求都不发', async () => {
    mocks.lookup.mockResolvedValue([{ address: '169.254.169.254' }])
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const r = await safeProbeRemoteFile('https://evil.example/x.mp4')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('内部地址')
    expect(fetchSpy, '判定为内网就不该发请求').not.toHaveBeenCalled()
  })

  it('域名解析出多个地址，只要有一个是内网就拒（防混合解析绕过）', async () => {
    mocks.lookup.mockResolvedValue([{ address: '8.8.8.8' }, { address: '10.0.0.1' }])
    vi.stubGlobal('fetch', vi.fn())
    const r = await safeProbeRemoteFile('https://mixed.example/x.mp4')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('内部地址')
  })

  it('🔴 公网地址 302 跳到内网 → 第二跳被拦（这就是只校验首个 URL 会漏的那种）', async () => {
    mocks.lookup
      .mockResolvedValueOnce([{ address: '8.8.8.8' }])          // 第一跳：公网，放行
      .mockResolvedValueOnce([{ address: '169.254.169.254' }])  // 第二跳：元数据，必须拦
    const fetchSpy = vi.fn().mockResolvedValue({
      status: 302,
      headers: { get: (k: string) => (k === 'location' ? 'http://169.254.169.254/latest/meta-data/' : null) },
    })
    vi.stubGlobal('fetch', fetchSpy)

    const r = await safeProbeRemoteFile('https://ok.example/x.mp4')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('内部地址')
    expect(fetchSpy, '只该发出第一跳，第二跳在校验阶段就被挡下').toHaveBeenCalledTimes(1)
  })

  it('🔴 不许用 redirect:follow —— 必须自己逐跳走', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, status: 206, headers: { get: () => 'video/mp4' },
    })
    vi.stubGlobal('fetch', fetchSpy)
    await safeProbeRemoteFile('https://ok.example/x.mp4')
    expect(fetchSpy.mock.calls[0][1].redirect).toBe('manual')
  })

  it('跳转次数过多 → 拒', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      status: 302,
      headers: { get: (k: string) => (k === 'location' ? 'https://ok.example/again' : null) },
    })
    vi.stubGlobal('fetch', fetchSpy)
    const r = await safeProbeRemoteFile('https://ok.example/x.mp4')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('跳转太多次')
  })

  it('正常公网视频 → 通过，带回 content-type', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 206, headers: { get: () => 'video/mp4' },
    }))
    const r = await safeProbeRemoteFile('https://ok.example/x.mp4')
    expect(r.ok).toBe(true)
    expect(r.contentType).toBe('video/mp4')
  })

  it('相对跳转也能解，且新地址照样校验', async () => {
    mocks.lookup
      .mockResolvedValueOnce([{ address: '8.8.8.8' }])
      .mockResolvedValueOnce([{ address: '8.8.8.8' }])
    let call = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      call++
      return call === 1
        ? { status: 302, headers: { get: (k: string) => (k === 'location' ? '/moved.mp4' : null) } }
        : { ok: true, status: 206, headers: { get: () => 'video/mp4' } }
    }))
    const r = await safeProbeRemoteFile('https://ok.example/x.mp4')
    expect(r.ok).toBe(true)
    expect(r.finalUrl).toBe('https://ok.example/moved.mp4')
  })
})
