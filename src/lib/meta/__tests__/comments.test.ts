/**
 * 评论读取的失败分类。
 *
 * 这套判断决定「下一轮还问不问 Meta」，所以必须离线可验：
 * 判错成 transient = 每半小时重复一次同样的 400（就是 2026-08-15 那个现象）；
 * 判错成永久 = 一次限流就把一个还能读的帖子钉死。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { classifyCommentFetchError, fetchPostCommentsResult } from '../comments'

/** 三条都是 2026-08-15 生产日志里的原文。 */
const ERR_10 = JSON.stringify({
  error: {
    message:
      "(#10) This endpoint requires the 'pages_read_user_content' permission or the 'Page Public Content Access' feature",
    type: 'OAuthException',
    code: 10,
  },
})
const ERR_100 = JSON.stringify({
  error: {
    message:
      "Unsupported get request. Object with ID '1616575215312482_1672828167982705' does not exist, cannot be loaded due to missing permissions, or does not support this operation",
    type: 'GraphMethodException',
    code: 100,
    error_subcode: 33,
  },
})
const ERR_12 = JSON.stringify({
  error: {
    message: '(#12) singular statuses API is deprecated for versions v2.4 and higher',
    type: 'OAuthException',
    code: 12,
  },
})

describe('classifyCommentFetchError', () => {
  it('🔴 #10 缺权限 = 永久，重试到天荒地老也不会变', () => {
    const f = classifyCommentFetchError(ERR_10)
    expect(f.reason).toBe('permission_denied')
    expect(f.transient).toBe(false)
    expect(f.code).toBe(10)
  })

  it('🔴 #100/33 帖子不存在 = 永久', () => {
    const f = classifyCommentFetchError(ERR_100)
    expect(f.reason).toBe('object_gone')
    expect(f.transient).toBe(false)
    expect(f.subcode).toBe(33)
  })

  it('🔴 #12 老式 status 端点已下线 = 永久（Graph 没有替代调用）', () => {
    const f = classifyCommentFetchError(ERR_12)
    expect(f.reason).toBe('deprecated_object')
    expect(f.transient).toBe(false)
  })

  it('#190 令牌被拒单独一类 —— 那是整个主页的事，不是某个帖子的事', () => {
    const f = classifyCommentFetchError(
      JSON.stringify({ error: { message: 'Error validating access token', code: 190 } }),
    )
    expect(f.reason).toBe('token_invalid')
    expect(f.transient).toBe(false)
  })

  it('限流 = 临时，下一轮照常再问', () => {
    const f = classifyCommentFetchError(
      JSON.stringify({ error: { message: 'User request limit reached', code: 4 } }),
    )
    expect(f.reason).toBe('transient')
    expect(f.transient).toBe(true)
  })

  it('🔴 认不出的形状一律当临时 —— 多问几次很便宜，误钉死一个能读的帖子不便宜', () => {
    expect(classifyCommentFetchError('<html>502 Bad Gateway</html>').reason).toBe('transient')
    expect(classifyCommentFetchError('').reason).toBe('transient')
    expect(classifyCommentFetchError(JSON.stringify({ error: { code: 100 } })).reason).toBe('transient')
  })
})

// ---------------------------------------------------------------------------

function fakeFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchPostCommentsResult', () => {
  it('读通了就返回评论，并标出主页自己写的那些', async () => {
    vi.stubGlobal(
      'fetch',
      fakeFetch(200, {
        data: [
          { id: 'c1', message: '多少钱', created_time: '2026-08-15T00:00:00Z', from: { id: 'u1', name: 'Ada Lee' } },
          { id: 'c2', message: '已私信', created_time: '2026-08-15T01:00:00Z', from: { id: 'page1' } },
        ],
      }),
    )
    const r = await fetchPostCommentsResult('page1_p1', 'page1', 'tok')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.comments).toHaveLength(2)
    expect(r.comments[0].isFromPage).toBe(false)
    expect(r.comments[1].isFromPage).toBe(true)
  })

  it('🔴 400 要把原因带回来 —— 老代码一律吞成空数组，正是「静默失败」那个病', async () => {
    vi.stubGlobal('fetch', fakeFetch(400, ERR_10))
    const r = await fetchPostCommentsResult('page1_p1', 'page1', 'tok')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.failure.reason).toBe('permission_denied')
  })

  it('网络挂了 = 临时，不该被记成永久跳过', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))
    const r = await fetchPostCommentsResult('page1_p1', 'page1', 'tok')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.failure.transient).toBe(true)
  })

  it('🔴 #12 也要带原因回来 —— 这类是端点用错了，跟缺权限得分开处理', async () => {
    vi.stubGlobal('fetch', fakeFetch(400, ERR_12))
    const r = await fetchPostCommentsResult('page1_p1', 'page1', 'tok')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.failure.reason).toBe('deprecated_object')
  })
})
