/**
 * 评论自动回复一整轮：扫描能不能扫完、扫不完会不会被看见、没权限会不会乱发。
 *
 * Meta 这边用真实形状的 Graph 响应（CTS 2026-09-14 的原话）走全局 fetch；
 * 数据库按表建模，记下每张表被写了什么。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PAGE = '1616575215312482'
const POST = `${PAGE}_1672828167982705`
const REDUCE_DATA_BODY = {
  error: { code: 1, message: "Please reduce the amount of data you're asking for, then retry your request" },
}

// ---- database fake, modelled per table ------------------------------------

const writes: Array<{ table: string; op: 'insert' | 'update'; row: unknown }> = []

function tableFake(table: string) {
  const reads: Record<string, unknown> = {
    clients: { name: 'Test Client', domain: 'example.co.nz', meta_ad_account_id: null },
    social_comment_config: { unreadable_post_ids: [] },
  }
  const b: Record<string, unknown> = {}
  const chain = () => b
  b.select = chain
  b.eq = chain
  b.in = chain
  b.insert = (row: unknown) => { writes.push({ table, op: 'insert', row }); return b }
  b.update = (row: unknown) => { writes.push({ table, op: 'update', row }); return b }
  b.maybeSingle = async () => ({ data: reads[table] ?? null, error: null })
  b.single = async () => ({ data: { id: 'row-1', attempts: 1 }, error: null })
  // `await supabase.from(t).select().in(...)` — engagements pre-filter: nothing seen yet
  b.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
  return b
}

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (t: string) => tableFake(t) } }))
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: async () => 'user-token' }))
vi.mock('@/lib/meta/ads-posts', () => ({ fetchAdStoryIds: async () => [] }))
vi.mock('../comment-classifier', () => ({
  classifyComment: async () => ({
    category: 'praise', confidence: 0.95, publicReply: 'Thanks so much!', publicReplyAfterDm: null,
    privateReply: null, shouldHide: false, needsHuman: false, guardrailFlags: [], replySource: 'llm',
  }),
}))

import { processClientComments, describeFailedClients, type CommentConfig } from '../comment-autoreply-engine'

// ---- Graph fake ------------------------------------------------------------

interface GraphScript {
  publishedPosts: Array<{ status: number; body: unknown }>
  permissions: { status: number; body: unknown }
}

const calls: Array<{ method: string; path: string }> = []

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status })
}

function installGraph(script: GraphScript) {
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    const method = init?.method ?? 'GET'
    calls.push({ method, path: url.pathname })
    const p = url.pathname.replace('/v20.0', '').replace('/v21.0', '')
    if (p === '/me/accounts') return json(200, { data: [{ id: PAGE, access_token: 'page-token' }] })
    if (p === '/me/permissions') return json(script.permissions.status, script.permissions.body)
    if (p === `/${PAGE}/published_posts`) {
      const next = script.publishedPosts.shift()
      if (!next) throw new Error('fake graph: published_posts called more times than scripted')
      return json(next.status, next.body)
    }
    if (p === `/${PAGE}/video_reels`) return json(200, { data: [], paging: { cursors: { before: 'x', after: 'y' } } })
    if (p === `/${POST}/comments` && method === 'GET') {
      return json(200, {
        data: [{ id: `${POST}_900`, message: 'Loved this trip!', created_time: new Date().toISOString(), from: { id: '42', name: 'Jane Doe' } }],
      })
    }
    if (p === `/${POST}_900/comments` && method === 'POST') return json(200, { id: `${POST}_901` })
    throw new Error(`fake graph: unmodelled ${method} ${p}`)
  }))
}

const onePostPage = { status: 200, body: { data: [{ id: POST }], paging: { cursors: { before: 'a', after: 'b' } } } }
const grants = (...scopes: string[]) => ({
  status: 200,
  body: { data: ['pages_show_list', 'pages_read_engagement', ...scopes].map((permission) => ({ permission, status: 'granted' })) },
})

const config: CommentConfig = {
  client_id: 'client-1', fb_page_id: PAGE,
  auto_reply_praise: true, auto_reply_question: true, auto_reply_complaint: true,
  auto_hide_spam: true, private_reply_enabled: false, lookback_days: 7, max_replies_per_run: 10,
}

const sends = () => calls.filter((c) => c.method !== 'GET')
const engagementWrites = () => writes.filter((w) => w.table === 'social_comment_engagements' && w.op === 'insert')

beforeEach(() => {
  writes.length = 0
  calls.length = 0
})
afterEach(() => vi.unstubAllGlobals())

describe('processClientComments — scan', () => {
  it('🔴 CTS case: code 1 on the post list is recovered by a smaller page, and the comment is found', async () => {
    installGraph({ publishedPosts: [{ status: 500, body: REDUCE_DATA_BODY }, onePostPage], permissions: grants('pages_manage_engagement') })
    const r = await processClientComments(config)

    expect(r.ok).toBe(true)
    expect(r.scan_error).toBeUndefined()
    expect(r.posts_scanned).toBe(1)
    expect(r.new_comments).toBe(1)
  })

  it('🔴 a post list that cannot be read → ok=false with the reason, never a quiet healthy run', async () => {
    installGraph({
      publishedPosts: [REDUCE_DATA_BODY, REDUCE_DATA_BODY, REDUCE_DATA_BODY, REDUCE_DATA_BODY].map((body) => ({ status: 500, body })),
      permissions: grants('pages_manage_engagement'),
    })
    const r = await processClientComments(config)

    expect(r.ok).toBe(false)
    expect(r.scan_error).toContain('published_posts')
    expect(r.scan_error).toContain('code=1')
    expect(r.error).toContain('comment scan incomplete')
  })
})

describe('processClientComments — reply permission', () => {
  it('🔴 without pages_manage_engagement: sends nothing, claims nothing, flags it', async () => {
    installGraph({ publishedPosts: [onePostPage], permissions: grants('pages_read_user_content') })
    const r = await processClientComments(config)

    expect(r.ok).toBe(true)
    expect(r.engagement_scope_missing).toBe(true)
    expect(r.new_comments).toBe(1)
    expect(r.public_replies).toBe(0)
    expect(sends()).toEqual([])
    // unclaimed, so the comment is handled once the permission is granted
    expect(engagementWrites()).toEqual([])
  })

  it('🔴 permission list unreadable → fail closed (no sends) and the run is not ok', async () => {
    installGraph({ publishedPosts: [onePostPage], permissions: { status: 500, body: { error: { code: 2, message: 'Service temporarily unavailable' } } } })
    const r = await processClientComments(config)

    expect(r.ok).toBe(false)
    expect(r.engagement_scope_missing).toBeUndefined()
    expect(r.scan_error).toContain('/me/permissions')
    expect(sends()).toEqual([])
  })

  it('with the permission granted the reply path still runs (the guard does not block a healthy client)', async () => {
    installGraph({ publishedPosts: [onePostPage], permissions: grants('pages_manage_engagement') })
    const r = await processClientComments(config)

    expect(r.engagement_scope_missing).toBeUndefined()
    expect(r.public_replies).toBe(1)
    expect(sends()).toEqual([{ method: 'POST', path: `/v20.0/${POST}_900/comments` }])
    expect(engagementWrites()).toHaveLength(1)
  })
})

describe('describeFailedClients', () => {
  it('all clean → no run-level error (the run stays completed)', () => {
    expect(describeFailedClients([{ client_id: 'a', ok: true }])).toBeUndefined()
  })

  it('🔴 any failed client → run-level error naming the client and the reason', () => {
    const msg = describeFailedClients([
      { client_id: 'a', ok: true },
      { client_id: 'client-1', ok: false, error: 'comment scan incomplete: published_posts 1616575215312482: 500 code=1' },
    ])
    expect(msg).toContain('1/2 clients failed')
    expect(msg).toContain('client-1: comment scan incomplete')
  })
})
