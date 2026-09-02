/**
 * 给已有联系人改标签 —— 护栏的回归测试。
 *
 * 最重要的两条不是「能不能打上」，是：
 *   · 人不在名单里时**绝不新建**（新建再打 paid_customer = 凭空把一个陌生地址
 *     踢出所有营销名单，没人会发现）
 *   · 标签已经对了就**不发写请求**（补历史要跑几百个人，重跑必须幂等且便宜）
 *
 * 假 fetch 按 **URL 路由**建模，不按调用次序 —— 按次序写的假件会让「先查后改」
 * 这个顺序即使被改坏也照样绿。
 */

import { describe, expect, it } from 'vitest'
import { applyMemberTags, findMemberByEmail, subscriberHash } from '../tags'

const CFG = { apiKey: 'key-us19', audienceId: 'dda97b7e61' }
const EMAIL = 'enrkay@gmail.com'

interface Call {
  url: string
  method: string
  body?: unknown
}

/** 按「这个邮箱在名单里是什么样」建模，而不是按第几次调用。 */
function fakeFetch(member: { status: string; tags: string[] } | null) {
  const calls: Call[] = []
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET'
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })

    const isTagWrite = url.includes('/tags')
    if (isTagWrite) return new Response(null, { status: 204 })

    if (!member) return new Response(JSON.stringify({ title: 'Resource Not Found' }), { status: 404 })
    return new Response(
      JSON.stringify({
        email_address: EMAIL,
        status: member.status,
        tags: member.tags.map((name) => ({ name })),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
  return { impl, calls }
}

describe('subscriberHash', () => {
  it('大小写和空格不影响 hash（Mailchimp 认小写 md5）', () => {
    expect(subscriberHash('  ENRKay@Gmail.com ')).toBe(subscriberHash('enrkay@gmail.com'))
  })
})

describe('findMemberByEmail', () => {
  it('名单里没有 → not_in_audience，不是 error', () => {
    const { impl } = fakeFetch(null)
    return findMemberByEmail({ ...CFG, fetchImpl: impl }, EMAIL).then((r) => {
      expect(r.status).toBe('not_in_audience')
    })
  })

  it('找到了 → 带回真实状态和标签', async () => {
    const { impl } = fakeFetch({ status: 'subscribed', tags: ['paid_customer', 'fb_lead'] })
    const r = await findMemberByEmail({ ...CFG, fetchImpl: impl }, EMAIL)
    expect(r.status).toBe('found')
    if (r.status === 'found') {
      expect(r.member.tags).toEqual(['paid_customer', 'fb_lead'])
      expect(r.member.status).toBe('subscribed')
    }
  })

  it('邮箱格式不对 → error 且不可重试，一个请求都不发', async () => {
    const { impl, calls } = fakeFetch(null)
    const r = await findMemberByEmail({ ...CFG, fetchImpl: impl }, 'not-an-email')
    expect(r).toEqual({ status: 'error', reason: 'invalid_email', retryable: false })
    expect(calls).toHaveLength(0)
  })
})

describe('applyMemberTags · 🔴 绝不新建', () => {
  it('🔴 人不在名单里 → skipped，且**没有发出任何写请求**', async () => {
    const { impl, calls } = fakeFetch(null)
    const r = await applyMemberTags({ ...CFG, fetchImpl: impl }, EMAIL, { add: ['paid_customer'] })
    expect(r).toEqual({ status: 'skipped', reason: 'not_in_audience' })
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  })
})

describe('applyMemberTags · 幂等', () => {
  it('🔴 标签已经对了 → noop，不发写请求（补历史重跑要便宜）', async () => {
    const { impl, calls } = fakeFetch({ status: 'subscribed', tags: ['paid_customer'] })
    const r = await applyMemberTags({ ...CFG, fetchImpl: impl }, EMAIL, { add: ['paid_customer'] })
    expect(r).toEqual({ status: 'noop', reason: 'already_correct' })
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  })

  it('摘一个本来就没有的标签 → noop', async () => {
    const { impl, calls } = fakeFetch({ status: 'subscribed', tags: ['paid_customer'] })
    const r = await applyMemberTags({ ...CFG, fetchImpl: impl }, EMAIL, { remove: ['fb_lead'] })
    expect(r.status).toBe('noop')
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  })

  it('什么都不改 → noop，一个请求都不发（连查都不查）', async () => {
    const { impl, calls } = fakeFetch({ status: 'subscribed', tags: [] })
    const r = await applyMemberTags({ ...CFG, fetchImpl: impl }, EMAIL, {})
    expect(r).toEqual({ status: 'noop', reason: 'nothing_to_do' })
    expect(calls).toHaveLength(0)
  })
})

describe('applyMemberTags · 真的改', () => {
  it('加 paid_customer + 摘 fb_lead → 一次写请求，两个动作', async () => {
    const { impl, calls } = fakeFetch({ status: 'subscribed', tags: ['fb_lead'] })
    const r = await applyMemberTags({ ...CFG, fetchImpl: impl }, EMAIL, {
      add: ['paid_customer'],
      remove: ['fb_lead'],
    })
    expect(r).toEqual({ status: 'applied', added: ['paid_customer'], removed: ['fb_lead'] })

    const writes = calls.filter((c) => c.method === 'POST')
    expect(writes).toHaveLength(1)
    expect(writes[0].body).toEqual({
      tags: [
        { name: 'paid_customer', status: 'active' },
        { name: 'fb_lead', status: 'inactive' },
      ],
    })
  })

  it('只加没有的那个，已有的不重复发', async () => {
    const { impl, calls } = fakeFetch({ status: 'subscribed', tags: ['paid_customer'] })
    const r = await applyMemberTags({ ...CFG, fetchImpl: impl }, EMAIL, {
      add: ['paid_customer', 'vip'],
    })
    expect(r).toEqual({ status: 'applied', added: ['vip'], removed: [] })
    expect((calls.filter((c) => c.method === 'POST')[0].body as { tags: unknown[] }).tags).toEqual([
      { name: 'vip', status: 'active' },
    ])
  })

  it('archived 的人也能打标签（Dave Attwell 就是这种）', async () => {
    const { impl } = fakeFetch({ status: 'archived', tags: ['booked'] })
    const r = await applyMemberTags({ ...CFG, fetchImpl: impl }, EMAIL, { add: ['paid_customer'] })
    expect(r.status).toBe('applied')
  })
})

describe('applyMemberTags · 出错时分得清能不能重试', () => {
  it('401 → 不可重试（key 坏了，重试一万次也一样）', async () => {
    const impl = async () => new Response(null, { status: 401 })
    const r = await applyMemberTags({ ...CFG, fetchImpl: impl }, EMAIL, { add: ['x'] })
    expect(r).toEqual({ status: 'error', reason: 'unauthorized', retryable: false })
  })

  it('500 → 可重试', async () => {
    const impl = async () => new Response(null, { status: 500 })
    const r = await applyMemberTags({ ...CFG, fetchImpl: impl }, EMAIL, { add: ['x'] })
    expect(r).toEqual({ status: 'error', reason: 'http_500', retryable: true })
  })

  it('网络挂了 → 可重试', async () => {
    const impl = async () => {
      throw new Error('ECONNRESET')
    }
    const r = await applyMemberTags({ ...CFG, fetchImpl: impl }, EMAIL, { add: ['x'] })
    expect(r).toEqual({ status: 'error', reason: 'network', retryable: true })
  })

  it('🔴 错误信息里不回显邮箱（PII）', async () => {
    const impl = async () => new Response(null, { status: 500 })
    const r = await applyMemberTags({ ...CFG, fetchImpl: impl }, EMAIL, { add: ['x'] })
    expect(JSON.stringify(r)).not.toContain(EMAIL)
  })
})
