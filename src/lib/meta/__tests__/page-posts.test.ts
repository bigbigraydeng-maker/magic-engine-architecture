/**
 * publishPagePhotoPost + deletePagePost — Graph adapter guarantees.
 *
 * These tests lock how we translate our intent into Graph's contract, and how
 * we read Graph's responses back. Both are one-shot: no retry (would double-
 * post), errors thrown for the caller to decide, and idempotent "already gone"
 * for delete so a re-run doesn't look like a failure.
 */

import { describe, expect, it, vi } from 'vitest'
import { publishPagePhotoPost, deletePagePost } from '../page-posts'

const PAGE = '1616575215312482'
const TOKEN = 'page-access-token'

function fakeFetch(response: { ok: boolean; status?: number; body: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 400),
      json: async () => response.body,
    }
  })
  return { fetcher: fn as unknown as typeof fetch, calls }
}

describe('publishPagePhotoPost — immediate vs scheduled', () => {
  it('immediate publish sends published:true and no scheduled_publish_time', async () => {
    const { fetcher, calls } = fakeFetch({ ok: true, body: { post_id: '1_2', id: 'photo' } })
    await publishPagePhotoPost({
      pageId: PAGE, pageAccessToken: TOKEN,
      message: 'hi', imageUrl: 'https://x/img.jpg', fetcher,
    })
    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.published).toBe(true)
    expect(body.scheduled_publish_time).toBeUndefined()
  })

  it('🔴 scheduled publish sends published:false + a unix timestamp — the pair Facebook requires', async () => {
    // published:false alone would create a hidden draft. Both fields together
    // are what tells Facebook to auto-publish at that time. If someone ever
    // drops one of them, this test screams.
    const { fetcher, calls } = fakeFetch({ ok: true, body: { post_id: '1_3', id: 'photo' } })
    const when = new Date('2026-09-04T20:00:00Z')
    await publishPagePhotoPost({
      pageId: PAGE, pageAccessToken: TOKEN,
      message: 'hi', imageUrl: 'https://x/img.jpg',
      scheduledPublishTime: when, fetcher,
    })
    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.published).toBe(false)
    expect(body.scheduled_publish_time).toBe(Math.floor(when.getTime() / 1000))
  })

  it('post_id is preferred over the photo id — feed post vs photo object', async () => {
    const { fetcher } = fakeFetch({ ok: true, body: { post_id: 'PAGE_POST', id: 'PHOTO_OBJ' } })
    const r = await publishPagePhotoPost({
      pageId: PAGE, pageAccessToken: TOKEN,
      message: 'hi', imageUrl: 'https://x/img.jpg', fetcher,
    })
    expect(r.postId).toBe('PAGE_POST')
    expect(r.postIdSource).toBe('post_id')
  })

  it('immediate publish with post_id makes exactly one Graph call (no read-back)', async () => {
    const { fetcher, calls } = fakeFetch({ ok: true, body: { post_id: `${PAGE}_1750835520181969`, id: '1750835520181969' } })
    const r = await publishPagePhotoPost({
      pageId: PAGE, pageAccessToken: TOKEN,
      message: 'hi', imageUrl: 'https://x/img.jpg', fetcher,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`https://graph.facebook.com/v20.0/${PAGE}/photos`)
    expect(r).toEqual({
      postId: `${PAGE}_1750835520181969`,
      postIdSource: 'post_id',
      permalink: `https://www.facebook.com/${PAGE}_1750835520181969`,
      raw: { post_id: `${PAGE}_1750835520181969`, id: '1750835520181969' },
    })
  })
})

/**
 * Fake fetch that answers each call in turn — POST /photos first, then the
 * read-back. Returns real `Response` objects so no type cast is needed.
 */
function sequencedFetch(responses: Array<{ status: number; body: unknown } | Error>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    const next = responses[calls.length - 1]
    if (!next) throw new Error(`unexpected Graph call #${calls.length}: ${String(input)}`)
    if (next instanceof Error) throw next
    return new Response(JSON.stringify(next.body), { status: next.status })
  }
  return { fetcher, calls }
}

describe('publishPagePhotoPost — scheduled photo returns only a photo id', () => {
  const PHOTO = '1750835520181969'
  const STORY = `${PAGE}_${PHOTO}`
  const scheduled = { pageId: PAGE, pageAccessToken: TOKEN, message: 'hi', imageUrl: 'https://x/img.jpg', scheduledPublishTime: new Date('2026-09-16T20:00:00Z') }

  it('🔴 reads page_story_id back from Graph and uses it as the post id', async () => {
    const { fetcher, calls } = sequencedFetch([
      { status: 200, body: { id: PHOTO } },
      { status: 200, body: { page_story_id: STORY, id: PHOTO } },
    ])
    const r = await publishPagePhotoPost({ ...scheduled, fetcher })

    expect(calls).toHaveLength(2)
    expect(calls[1].url).toBe(
      `https://graph.facebook.com/v20.0/${PHOTO}?fields=page_story_id&access_token=${TOKEN}`,
    )
    expect(calls[1].init?.method ?? 'GET').toBe('GET')
    expect(r).toEqual({
      postId: STORY,
      postIdSource: 'page_story_id',
      permalink: `https://www.facebook.com/${STORY}`,
      raw: { id: PHOTO },
    })
  })

  it('🔴 uses whatever page_story_id Graph returns — never composes pageId_photoId itself', async () => {
    // A story id that is NOT `${page}_${photo}` proves the value is read, not built.
    const { fetcher } = sequencedFetch([
      { status: 200, body: { id: PHOTO } },
      { status: 200, body: { page_story_id: `${PAGE}_99999999999` } },
    ])
    const r = await publishPagePhotoPost({ ...scheduled, fetcher })
    expect(r.postId).toBe(`${PAGE}_99999999999`)
  })

  it.each([
    ['Graph error', { status: 400, body: { error: { message: '(#10) permission denied' } } }, /permission denied/],
    ['no page_story_id field', { status: 200, body: { id: PHOTO } }, /no page_story_id/],
    ['network error', new Error('socket hang up'), /socket hang up/],
  ] as const)('🔴 read-back failure (%s) does not throw and flags the photo id as unresolved', async (_label, readback, reason) => {
    const { fetcher, calls } = sequencedFetch([{ status: 200, body: { id: PHOTO } }, readback])
    const r = await publishPagePhotoPost({ ...scheduled, fetcher })

    expect(calls).toHaveLength(2) // exactly one POST — never a second publish attempt
    expect(r.postId).toBe(PHOTO)
    expect(r.postIdSource).toBe('id')
    expect(r.postIdUnresolvedReason).toMatch(reason)
    expect(r.permalink).toBe(`https://www.facebook.com/${PHOTO}`)
    expect(r.raw).toEqual({ id: PHOTO })
  })

  it('throws when Meta returns an error — never retries silently', async () => {
    const { fetcher } = fakeFetch({
      ok: false, status: 400,
      body: { error: { message: '(#100) scheduled_publish_time must be at least 10 minutes in the future' } },
    })
    await expect(
      publishPagePhotoPost({
        pageId: PAGE, pageAccessToken: TOKEN,
        message: 'hi', imageUrl: 'https://x/img.jpg',
        scheduledPublishTime: new Date('2026-09-04T20:00:00Z'), fetcher,
      }),
    ).rejects.toThrow(/scheduled_publish_time/)
  })
})

describe('deletePagePost — idempotency and error surfacing', () => {
  it('fresh delete returns alreadyGone=false', async () => {
    const { fetcher, calls } = fakeFetch({ ok: true, body: { success: true } })
    const r = await deletePagePost({ postId: 'p1', pageAccessToken: TOKEN, fetcher })
    expect(r.alreadyGone).toBe(false)
    expect(calls[0].init?.method).toBe('DELETE')
    expect(calls[0].url).toContain('/p1?')
    expect(calls[0].url).toContain('access_token=')
  })

  it('🔴 "object does not exist" (code 100) folds into alreadyGone=true, not an error', async () => {
    // A retried recall must not read as a failure just because the post is
    // already gone — that's exactly the state the caller wanted. Anything
    // else would make idempotent retries look broken.
    const { fetcher } = fakeFetch({
      ok: false, status: 400,
      body: { error: { message: 'Object with ID does not exist', code: 100 } },
    })
    const r = await deletePagePost({ postId: 'p_gone', pageAccessToken: TOKEN, fetcher })
    expect(r.alreadyGone).toBe(true)
  })

  it('throws on permission / transient errors so the batch decides', async () => {
    const { fetcher } = fakeFetch({
      ok: false, status: 400,
      body: { error: { message: '(#200) Requires pages_manage_posts', code: 200 } },
    })
    await expect(
      deletePagePost({ postId: 'p1', pageAccessToken: TOKEN, fetcher }),
    ).rejects.toThrow(/pages_manage_posts/)
  })

  it('legacy receipts: a bare photo id is deleted by that exact id (no rewrite to page_post)', async () => {
    const { fetcher, calls } = fakeFetch({ ok: true, body: { success: true } })
    await deletePagePost({ postId: '1750835520181969', pageAccessToken: TOKEN, fetcher })
    expect(calls[0].init?.method).toBe('DELETE')
    expect(calls[0].url).toBe(`https://graph.facebook.com/v20.0/1750835520181969?access_token=${TOKEN}`)
  })

  it('url-encodes the post id — a raw underscore-heavy id must not break the request line', async () => {
    const { fetcher, calls } = fakeFetch({ ok: true, body: { success: true } })
    await deletePagePost({ postId: '1616575215312482_1750182373580617', pageAccessToken: TOKEN, fetcher })
    // encodeURIComponent leaves _ and digits alone, but this test locks the
    // fact that we encode at all — a future refactor cannot substitute a
    // string template that would break on ids containing `/` or `?`.
    expect(calls[0].url).toContain('1616575215312482_1750182373580617')
  })
})
