import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenSrsError, callXcp, lookupDomain, resolveOpenSrsEnv } from '../client'
import { signXcpPayload } from '../xcp/signature'

const FAKE_KEY = 'FAKE_TEST_KEY_NOT_A_SECRET'

function xcpReply(items: string): string {
  return `<?xml version='1.0'?><!DOCTYPE OPS_envelope SYSTEM 'ops.dtd'><OPS_envelope>
    <header><version>0.9</version></header>
    <body><data_block><dt_assoc>${items}</dt_assoc></data_block></body>
  </OPS_envelope>`
}

const AVAILABLE = xcpReply(`
  <item key="is_success">1</item>
  <item key="response_code">210</item>
  <item key="response_text">Domain available</item>
  <item key="attributes"><dt_assoc><item key="status">available</item></dt_assoc></item>
`)

function mockFetch(body: string, status = 200) {
  const fn = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, text: async () => body })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('resolveOpenSrsEnv', () => {
  it('只有显式 "live" 才是生产', () => {
    expect(resolveOpenSrsEnv('live')).toBe('live')
  })

  it.each([undefined, '', 'test', 'production', 'LIVE', 'true'])(
    '%s 一律落回测试环境 —— 配置拼错不该变成真实扣款',
    (raw) => {
      expect(resolveOpenSrsEnv(raw)).toBe('test')
    },
  )
})

describe('callXcp', () => {
  beforeEach(() => {
    vi.stubEnv('OPENSRS_RESELLER_USERNAME', 'me-reseller')
    vi.stubEnv('OPENSRS_API_KEY', FAKE_KEY)
    vi.stubEnv('OPENSRS_ENV', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('没配环境变量时直接抛，而不是发一个注定被拒的请求', async () => {
    vi.stubEnv('OPENSRS_API_KEY', '')
    const fetchFn = mockFetch(AVAILABLE)
    await expect(callXcp({ action: 'LOOKUP', object: 'DOMAIN' })).rejects.toThrow(/not configured/i)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('默认打 horizon 测试端点，不是生产', async () => {
    const fetchFn = mockFetch(AVAILABLE)
    await callXcp({ action: 'LOOKUP', object: 'DOMAIN' })
    expect(fetchFn.mock.calls[0][0]).toBe('https://horizon.opensrs.net:55443')
  })

  it('显式 live 才打生产端点', async () => {
    vi.stubEnv('OPENSRS_ENV', 'live')
    const fetchFn = mockFetch(AVAILABLE)
    await callXcp({ action: 'LOOKUP', object: 'DOMAIN' })
    expect(fetchFn.mock.calls[0][0]).toBe('https://rr-n1-tor.opensrs.net:55443')
  })

  it('签名算的是真正发出去的那份正文', async () => {
    const fetchFn = mockFetch(AVAILABLE)
    await callXcp({ action: 'LOOKUP', object: 'DOMAIN', attributes: { domain: 'example.co.nz' } })
    const init = fetchFn.mock.calls[0][1]
    expect(init.headers['X-Username']).toBe('me-reseller')
    expect(init.headers['X-Signature']).toBe(signXcpPayload(init.body, FAKE_KEY))
    expect(init.headers['Content-Type']).toBe('text/xml')
  })

  it('is_success=0 抛 OpenSrsError 并带上响应码', async () => {
    mockFetch(xcpReply(`
      <item key="is_success">0</item>
      <item key="response_code">465</item>
      <item key="response_text">Missing required attribute</item>
    `))
    await expect(callXcp({ action: 'LOOKUP', object: 'DOMAIN' })).rejects.toMatchObject({
      name: 'OpenSrsError',
      responseCode: '465',
    })
  })

  it('HTTP 错误也抛，不把错误页当回包解析', async () => {
    mockFetch('<html>502 Bad Gateway</html>', 502)
    await expect(callXcp({ action: 'LOOKUP', object: 'DOMAIN' })).rejects.toBeInstanceOf(OpenSrsError)
  })

  it('报错信息里不许出现 API key 或请求正文', async () => {
    mockFetch(xcpReply(`
      <item key="is_success">0</item>
      <item key="response_code">400</item>
      <item key="response_text">nope</item>
    `))
    const err = await callXcp({
      action: 'LOOKUP',
      object: 'DOMAIN',
      attributes: { domain: 'secret-client.co.nz' },
    }).then(
      () => new Error('expected callXcp to reject, but it resolved'),
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(OpenSrsError)
    const message = err instanceof Error ? err.message : String(err)
    expect(message).not.toContain(FAKE_KEY)
    expect(message).not.toContain('secret-client.co.nz')
  })
})

describe('lookupDomain', () => {
  beforeEach(() => {
    vi.stubEnv('OPENSRS_RESELLER_USERNAME', 'me-reseller')
    vi.stubEnv('OPENSRS_API_KEY', FAKE_KEY)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('available 状态解析成可注册', async () => {
    mockFetch(AVAILABLE)
    await expect(lookupDomain('example.co.nz')).resolves.toEqual({
      domain: 'example.co.nz',
      available: true,
      status: 'available',
    })
  })

  it('taken 状态解析成不可注册，且原始状态串留着', async () => {
    mockFetch(xcpReply(`
      <item key="is_success">1</item>
      <item key="response_code">211</item>
      <item key="response_text">Domain taken</item>
      <item key="attributes"><dt_assoc><item key="status">taken</item></dt_assoc></item>
    `))
    await expect(lookupDomain('google.com')).resolves.toMatchObject({ available: false, status: 'taken' })
  })

  it('回包没有 status 时算作不可注册 —— 拿不到答案不等于"可以买"', async () => {
    mockFetch(xcpReply(`<item key="is_success">1</item><item key="response_code">200</item>`))
    await expect(lookupDomain('weird.com')).resolves.toMatchObject({ available: false, status: '' })
  })
})
