/**
 * AD-SEC-4 — comment auto-reply reads, replies to, hides and DMs on the Page in
 * social_comment_config, which client members can edit. It must only act on the
 * client's staff-bound Page, and only when that binding passes the sync gate.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: fromMock } }))
vi.mock('@/lib/meta/page-sync-authorization', () => ({ authorizePageSync: vi.fn() }))
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: vi.fn() }))
vi.mock('@/lib/meta/page-posts', () => ({ fetchPagePosts: vi.fn(), fetchPageReels: vi.fn() }))
vi.mock('@/lib/meta/ads-posts', () => ({ fetchAdStoryIds: vi.fn() }))
vi.mock('@/lib/meta/comments', () => ({
  fetchPostCommentsResult: vi.fn(), replyToComment: vi.fn(), sendPrivateReply: vi.fn(), hideComment: vi.fn(),
}))

import { processClientComments, type CommentConfig } from '../comment-autoreply-engine'
import { authorizePageSync } from '@/lib/meta/page-sync-authorization'
import { fetchPagePosts, fetchPageReels } from '@/lib/meta/page-posts'
import { replyToComment, sendPrivateReply, hideComment } from '@/lib/meta/comments'

const mockAuth = vi.mocked(authorizePageSync)
const OWN_PAGE = '1616575215312482'
const OTHER_PAGE = '227633594573276'

const config = (fb_page_id: string): CommentConfig => ({
  client_id: 'client-a', fb_page_id, auto_reply_praise: true, auto_reply_question: true,
  auto_reply_complaint: true, auto_hide_spam: true, private_reply_enabled: true, lookback_days: 3, max_replies_per_run: 10,
})

function boundPage(pageId: string | null) {
  fromMock.mockImplementation(() => {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { facebook_page_id: pageId }, error: null }) }
    return chain
  })
}

const nothingTouched = () => {
  expect(fetchPagePosts).not.toHaveBeenCalled()
  expect(fetchPageReels).not.toHaveBeenCalled()
  expect(replyToComment).not.toHaveBeenCalled()
  expect(sendPrivateReply).not.toHaveBeenCalled()
  expect(hideComment).not.toHaveBeenCalled()
}

beforeEach(() => {
  delete process.env.SOCIAL_COMMENT_AUTOREPLY_KILL
  mockAuth.mockResolvedValue({ ok: true, pageToken: 'page-token', via: 'staff_verified' })
})
afterEach(() => vi.clearAllMocks())

describe('comment auto-reply page gate', () => {
  it('config points at a Page that is not the client\'s bound Page → refused, nothing read or sent', async () => {
    boundPage(OWN_PAGE)
    const res = await processClientComments(config(OTHER_PAGE))
    expect(res).toMatchObject({ ok: false })
    expect(res.error).toContain('page_not_verified')
    expect(mockAuth).not.toHaveBeenCalled()
    nothingTouched()
  })

  it('client has no bound Page → refused', async () => {
    boundPage(null)
    const res = await processClientComments(config(OWN_PAGE))
    expect(res.ok).toBe(false)
    nothingTouched()
  })

  it('bound Page not verified as the client\'s → refused', async () => {
    boundPage(OWN_PAGE)
    mockAuth.mockResolvedValue({ ok: false, skipped: 'page_not_verified', reason: 'unverified_shared_token' })
    const res = await processClientComments(config(OWN_PAGE))
    expect(res.error).toBe('page_not_verified: unverified_shared_token')
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), 'client-a', OWN_PAGE, expect.anything())
    nothingTouched()
  })
})
