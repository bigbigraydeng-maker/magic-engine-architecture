/**
 * Mailchimp 读取层。
 *
 * 这份逻辑决定「谁该被排到销售名单最前面」，所以错了不是数字难看，
 * 是最热的客人被漏掉、或者根本没反应的人被当成热的去打扰。
 */

import { describe, expect, it, vi } from 'vitest'
import {
  datacenterFromKey,
  toPercent,
  normaliseCampaign,
  mergeActivity,
  MailchimpError,
  subscribeMember,
  type SubscribeMemberInput,
} from '../client'

describe('key 里的数据中心', () => {
  it('从 key 末尾取 host', () => {
    expect(datacenterFromKey('abc123def456-us14')).toBe('us14')
    expect(datacenterFromKey('  abc-us21  ')).toBe('us21')
  })

  /** 复制 key 时漏掉后缀是最常见的错。早点说人话，别等调用时甩一个 401。 */
  it('没后缀就当场说清楚，不留到调用时报 401', () => {
    expect(() => datacenterFromKey('abc123def456')).toThrow(MailchimpError)
    expect(() => datacenterFromKey('abc123def456')).toThrow(/数据中心/)
    expect(() => datacenterFromKey('')).toThrow()
  })
})

describe('比例换算', () => {
  it('0–1 小数换成百分数，保留一位', () => {
    expect(toPercent(0.582)).toBe(58.2)
    expect(toPercent(0.3333)).toBe(33.3)
    expect(toPercent(0)).toBe(0)
  })

  it('缺字段不炸，算 0', () => {
    expect(toPercent(undefined)).toBe(0)
    expect(toPercent(null)).toBe(0)
  })
})

describe('邮件汇总', () => {
  it('取标题、主题、发送时间和统计', () => {
    const c = normaliseCampaign({
      id: 'abc',
      settings: { title: 'Reborn E1 Enquiry R1', subject_line: '你的中国行' },
      send_time: '2026-07-06T09:00:00+00:00',
      emails_sent: 108,
      report_summary: { opens: 90, unique_opens: 62, clicks: 18, open_rate: 0.574, click_rate: 0.167 },
    })
    expect(c.title).toBe('Reborn E1 Enquiry R1')
    expect(c.emailsSent).toBe(108)
    expect(c.uniqueOpens).toBe(62)
    expect(c.openRate).toBe(57.4)
    expect(c.clickRate).toBe(16.7)
  })

  it('没有 report_summary 也不炸（刚发出去还没统计）', () => {
    const c = normaliseCampaign({ id: 'x', settings: {}, emails_sent: 0 })
    expect(c.openRate).toBe(0)
    expect(c.title).toBe('(未命名)')
    expect(c.sentAt).toBeNull()
  })
})

describe('合并「谁打开了」和「谁点了」', () => {
  it('两份名单合成每人一条', () => {
    const out = mergeActivity(
      [{ email_address: 'a@x.com', last_open: '2026-07-20T01:00:00Z' }],
      [{ email_address: 'b@x.com', timestamp: '2026-07-20T02:00:00Z' }],
    )
    expect(out).toHaveLength(2)
    expect(out.find((m) => m.email === 'a@x.com')).toMatchObject({ opened: true, clicked: false })
    expect(out.find((m) => m.email === 'b@x.com')).toMatchObject({ clicked: true })
  })

  /**
   * 这条是这份文件的重点：Mailchimp 靠一个隐藏图片记「打开」，客户端拦图片时
   * 就记不到。于是会出现「点了链接但没算打开」—— 如果照搬，最热的那批人
   * （真的点进来看了行程）会被当成没反应，掉出销售名单。
   */
  it('点了链接就必然算看过 —— 图片被拦时 Mailchimp 记不到打开', () => {
    const out = mergeActivity([], [{ email_address: 'c@x.com', timestamp: '2026-07-20T03:00:00Z' }])
    expect(out[0]).toMatchObject({ email: 'c@x.com', opened: true, clicked: true })
  })

  it('同一个人在两份名单里 → 合成一条，两个标记都在', () => {
    const out = mergeActivity(
      [{ email_address: 'd@x.com', last_open: '2026-07-20T01:00:00Z' }],
      [{ email_address: 'd@x.com', timestamp: '2026-07-20T05:00:00Z' }],
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ opened: true, clicked: true })
    // 时间取最晚那次动作
    expect(out[0].lastActionAt).toBe('2026-07-20T05:00:00Z')
  })

  it('邮箱大小写和空格不算两个人', () => {
    const out = mergeActivity(
      [{ email_address: '  Dave@Outlook.com ', last_open: '2026-07-20T01:00:00Z' }],
      [{ email_address: 'dave@outlook.com', timestamp: '2026-07-20T02:00:00Z' }],
    )
    expect(out).toHaveLength(1)
    expect(out[0].email).toBe('dave@outlook.com')
  })

  it('脏数据（没邮箱 / 空串）直接丢掉，不制造幽灵联系人', () => {
    const out = mergeActivity(
      [{ last_open: '2026-07-20T01:00:00Z' }, { email_address: '   ' }],
      [{ email_address: undefined }],
    )
    expect(out).toHaveLength(0)
  })

  it('两边都空 → 空数组，不炸', () => {
    expect(mergeActivity([], [])).toEqual([])
  })
})

describe('subscribeMember —— 唯一的写路径', () => {
  const baseInput = (over: Partial<SubscribeMemberInput> = {}): SubscribeMemberInput => ({
    apiKey: 'key123-us19',
    audienceId: 'dda97b7e61',
    email: 'chris@example.com',
    firstName: 'Chris',
    lastName: 'Brown',
    source: 'Meta Lead Form',
    tag: 'meta-lead',
    ...over,
  })

  function mockFetch(responses: Array<{ status: number; body?: unknown }>) {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fake = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      const next = responses.shift()
      if (!next) throw new Error('unexpected extra fetch call')
      calls.push({ url: String(url), init })
      return {
        status: next.status,
        json: async () => next.body ?? {},
        text: async () => JSON.stringify(next.body ?? {}),
      } as unknown as Response
    })
    return { fake: fake as unknown as typeof fetch, calls }
  }

  it('200 → subscribed，请求打对 URL + Basic auth + status subscribed + SOURCE merge field', async () => {
    const { fake, calls } = mockFetch([{ status: 200, body: { id: 'abc' } }])
    const res = await subscribeMember(baseInput({ fetchImpl: fake }))

    expect(res).toEqual({ status: 'subscribed' })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://us19.api.mailchimp.com/3.0/lists/dda97b7e61/members')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toMatch(/^Basic /)
    const body = JSON.parse(calls[0].init.body as string) as Record<string, unknown>
    expect(body.email_address).toBe('chris@example.com')
    expect(body.status).toBe('subscribed')
    expect(body.merge_fields).toEqual({
      FNAME: 'Chris',
      LNAME: 'Brown',
      SOURCE: 'Meta Lead Form',
    })
    expect(body.tags).toEqual(['meta-lead'])
  })

  it('400 title=Member Exists → already_member（**不**再打第二次去 PATCH / 重新订阅）', async () => {
    const { fake, calls } = mockFetch([
      { status: 400, body: { title: 'Member Exists', status: 400 } },
    ])
    const res = await subscribeMember(baseInput({ fetchImpl: fake }))

    expect(res).toEqual({ status: 'already_member' })
    expect(calls).toHaveLength(1)
  })

  it('400 其它 title → failed，reason 分类且带 providerStatus', async () => {
    const { fake } = mockFetch([
      { status: 400, body: { title: 'Invalid Resource', detail: 'merge field SOURCE does not exist' } },
    ])
    const res = await subscribeMember(baseInput({ fetchImpl: fake }))

    expect(res.status).toBe('failed')
    expect(res).toMatchObject({ providerStatus: 400 })
  })

  it('缺 SOURCE merge field 场景（Mailchimp 400 "merge field required"）→ failed:missing_merge_field', async () => {
    const { fake } = mockFetch([
      { status: 400, body: { title: 'The merge field SOURCE is required' } },
    ])
    const res = await subscribeMember(baseInput({ fetchImpl: fake }))

    expect(res).toMatchObject({
      status: 'failed',
      reason: 'missing_merge_field',
      providerStatus: 400,
    })
  })

  it('429 → failed:rate_limited', async () => {
    const { fake } = mockFetch([{ status: 429 }])
    const res = await subscribeMember(baseInput({ fetchImpl: fake }))
    expect(res).toMatchObject({ status: 'failed', reason: 'rate_limited', providerStatus: 429 })
  })

  it('503 → failed:provider_5xx', async () => {
    const { fake } = mockFetch([{ status: 503 }])
    const res = await subscribeMember(baseInput({ fetchImpl: fake }))
    expect(res).toMatchObject({ status: 'failed', reason: 'provider_5xx', providerStatus: 503 })
  })

  it('401 → failed:auth', async () => {
    const { fake } = mockFetch([{ status: 401 }])
    const res = await subscribeMember(baseInput({ fetchImpl: fake }))
    expect(res).toMatchObject({ status: 'failed', reason: 'auth', providerStatus: 401 })
  })

  it('404 audience 不存在 → failed:audience_not_found', async () => {
    const { fake } = mockFetch([{ status: 404 }])
    const res = await subscribeMember(baseInput({ fetchImpl: fake }))
    expect(res).toMatchObject({
      status: 'failed',
      reason: 'audience_not_found',
      providerStatus: 404,
    })
  })

  it('fetch 抛异常（网络/超时）→ failed:network_error，不抛出', async () => {
    const fake = vi.fn(async () => {
      throw new Error('ETIMEDOUT')
    }) as unknown as typeof fetch

    const res = await subscribeMember(baseInput({ fetchImpl: fake }))
    expect(res).toEqual({ status: 'failed', reason: 'network_error' })
  })

  it('缺 apiKey → skipped:no_api_key（一次 provider 调用都不发起）', async () => {
    const fake = vi.fn() as unknown as typeof fetch
    const res = await subscribeMember(baseInput({ apiKey: '', fetchImpl: fake }))
    expect(res).toEqual({ status: 'skipped', reason: 'no_api_key' })
    expect(fake).not.toHaveBeenCalled()
  })

  it('缺 audienceId → skipped:no_audience_id', async () => {
    const fake = vi.fn() as unknown as typeof fetch
    const res = await subscribeMember(baseInput({ audienceId: '', fetchImpl: fake }))
    expect(res).toEqual({ status: 'skipped', reason: 'no_audience_id' })
    expect(fake).not.toHaveBeenCalled()
  })

  it('邮箱不合法 → skipped:invalid_email，一次 provider 调用都不发起', async () => {
    const fake = vi.fn() as unknown as typeof fetch
    const res = await subscribeMember(baseInput({ email: 'not-an-email', fetchImpl: fake }))
    expect(res).toEqual({ status: 'skipped', reason: 'invalid_email' })
    expect(fake).not.toHaveBeenCalled()
  })

  it('key 格式错（末尾没数据中心后缀）→ skipped:bad_api_key_format', async () => {
    const fake = vi.fn() as unknown as typeof fetch
    const res = await subscribeMember(baseInput({ apiKey: 'no-dc-suffix-here', fetchImpl: fake }))
    expect(res).toEqual({ status: 'skipped', reason: 'bad_api_key_format' })
    expect(fake).not.toHaveBeenCalled()
  })

  it('firstName / lastName / tag 为空时不写进 payload', async () => {
    const { fake, calls } = mockFetch([{ status: 200 }])
    await subscribeMember(
      baseInput({ firstName: null, lastName: null, tag: undefined, fetchImpl: fake }),
    )
    const body = JSON.parse(calls[0].init.body as string) as Record<string, unknown>
    expect(body.merge_fields).toEqual({ SOURCE: 'Meta Lead Form' })
    expect(body).not.toHaveProperty('tags')
  })
})
