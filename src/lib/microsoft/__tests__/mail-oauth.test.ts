/**
 * 连接客户邮箱 —— 授权那一半的测试。
 *
 * 这条链路上最贵的两个错误，都不会当场报错：
 *
 *   1. **拿到一个没有刷新能力的令牌**。Microsoft 只在要过 offline_access 时才
 *      给刷新令牌。漏掉的话当天一切正常，一小时后同步安静地停摆，而没人会
 *      收到任何提示 —— 客人的邮件继续漏，我们以为接通了。
 *   2. **刷新时传的权限跟授权时不一致**。Microsoft 只给「本次要过」的权限发新
 *      令牌，两处对不上会悄悄降权，直到读信时才 403。
 *
 * 所以这里把「要哪些权限」当成一份契约钉死，而不是当成一个可以随手改的常量。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  exchangeCodeForTokens,
  fetchMailboxAddress,
  microsoftRedirectUri,
  MICROSOFT_MAIL_SCOPES,
} from '../mail-oauth'

const OK_TOKENS = {
  access_token: 'at-1',
  refresh_token: 'rt-1',
  expires_in: 3600,
  scope: MICROSOFT_MAIL_SCOPES.join(' '),
}

/** 记下每次请求的 body —— 断言「传出去的权限」时要用。 */
let sentBodies: string[]

function mockFetch(body: unknown, ok = true, status = 200) {
  sentBodies = []
  const fn = vi.fn(async (_url: string, init?: { body?: string }) => {
    sentBodies.push(String(init?.body ?? ''))
    return { ok, status, json: async () => body } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('要哪些权限 —— 这是一份契约，不是一个随手改的常量', () => {
  it('必须要 offline_access，否则拿不到刷新令牌，一小时后安静断掉', () => {
    expect(MICROSOFT_MAIL_SCOPES).toContain('offline_access')
  })

  it('要读信的权限', () => {
    expect(MICROSOFT_MAIL_SCOPES).toContain('https://graph.microsoft.com/Mail.Read')
  })

  it('一并要发信权限 —— 省得以后做「从 CRM 回信」时让客户再点一次同意', () => {
    expect(MICROSOFT_MAIL_SCOPES).toContain('https://graph.microsoft.com/Mail.Send')
  })

  /** 读信不需要改客户的邮箱。多要的每一分权限都是以后出事时说不清楚的地方。 */
  it('绝不要 Mail.ReadWrite —— 我们没有任何理由改客户的邮箱', () => {
    expect(MICROSOFT_MAIL_SCOPES.join(' ')).not.toContain('Mail.ReadWrite')
  })
})

describe('拿授权码换令牌', () => {
  it('正常换到令牌', async () => {
    vi.stubEnv('MICROSOFT_CLIENT_ID', 'cid')
    vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'secret')
    mockFetch(OK_TOKENS)

    const r = await exchangeCodeForTokens('code-1')
    expect(r).toMatchObject({ ok: true, tokens: { access_token: 'at-1', refresh_token: 'rt-1' } })
  })

  /**
   * 这条是整份测试的重点。没有刷新令牌 = 没连上，只是暂时看起来像连上了。
   * 宁可当场失败让人重点一次，也不要一小时后无声停摆。
   */
  it('没拿到刷新令牌 → 当场判失败，绝不当作连接成功存下来', async () => {
    vi.stubEnv('MICROSOFT_CLIENT_ID', 'cid')
    vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'secret')
    mockFetch({ access_token: 'at-1', expires_in: 3600 })

    const r = await exchangeCodeForTokens('code-1')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toContain('offline_access')
  })

  it('换令牌时传的权限，跟授权时要的完全一致（不一致会悄悄降权）', async () => {
    vi.stubEnv('MICROSOFT_CLIENT_ID', 'cid')
    vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'secret')
    mockFetch(OK_TOKENS)

    await exchangeCodeForTokens('code-1')
    const sent = new URLSearchParams(sentBodies[0]).get('scope')
    expect(sent).toBe(MICROSOFT_MAIL_SCOPES.join(' '))
  })

  it('Microsoft 拒了 → 把它给的原因原样带回来，不吞掉', async () => {
    vi.stubEnv('MICROSOFT_CLIENT_ID', 'cid')
    vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'secret')
    mockFetch({ error: 'invalid_grant', error_description: '授权码已用过' }, false, 400)

    const r = await exchangeCodeForTokens('code-1')
    expect(r).toMatchObject({ ok: false, error: '授权码已用过' })
  })

  it('没配好环境变量 → 说清楚缺什么，不发请求', async () => {
    vi.stubEnv('MICROSOFT_CLIENT_ID', '')
    vi.stubEnv('MICROSOFT_CLIENT_SECRET', '')
    const fn = mockFetch(OK_TOKENS)

    const r = await exchangeCodeForTokens('code-1')
    expect(r.ok).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('网络炸了也不抛异常 —— 回调页面要能对着人说一句话', async () => {
    vi.stubEnv('MICROSOFT_CLIENT_ID', 'cid')
    vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'secret')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET') }))

    const r = await exchangeCodeForTokens('code-1')
    expect(r).toMatchObject({ ok: false, error: 'ECONNRESET' })
  })
})

describe('连的到底是哪个邮箱 —— 必须问出来，不能让人手填', () => {
  it('企业邮箱走 mail 字段', async () => {
    mockFetch({ mail: 'info@ctstours.co.nz', userPrincipalName: 'svc@ctstours.onmicrosoft.com' })
    expect(await fetchMailboxAddress('at')).toBe('info@ctstours.co.nz')
  })

  it('没有 mail 字段时退回登录名（个人版 Outlook 常见）', async () => {
    mockFetch({ mail: null, userPrincipalName: 'someone@outlook.com' })
    expect(await fetchMailboxAddress('at')).toBe('someone@outlook.com')
  })

  it('问不出来就回 null —— 调用方据此拒绝保存，不留一条不知道是谁的连接', async () => {
    mockFetch({}, false, 403)
    expect(await fetchMailboxAddress('at')).toBeNull()
  })
})

describe('跳回地址', () => {
  it('start 和 callback 用同一个值 —— 两边写得不一样 Microsoft 会直接拒掉', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.magicengine.com.au')
    expect(microsoftRedirectUri()).toBe(
      'https://app.magicengine.com.au/api/auth/microsoft/mail/callback',
    )
  })

  it('配置里多写一个斜杠也不会变成双斜杠', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.magicengine.com.au/')
    expect(microsoftRedirectUri()).not.toContain('//api/')
  })
})
