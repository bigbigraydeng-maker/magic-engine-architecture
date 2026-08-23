/**
 * The callback is where a Meta grant becomes a stored connection. #1152 adds
 * one hard rule: what we persist must be what the provider ACTUALLY granted,
 * never the scope set we asked for. These tests exist to keep that honest — a
 * declined publishing permission must never be recorded as publish-ready, and
 * the publishing reauthorisation must fail closed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { NextResponse } from 'next/server'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  verifyState:                vi.fn(),
  exchangeCode:               vi.fn(),
  exchangeForLongLivedToken:  vi.fn(),
  listPagesWithTokens:        vi.fn(),
  listGrantedScopes:          vi.fn(),
  upsertConnection:           vi.fn(),
  upsertCalls:                [] as Array<Record<string, unknown>>,
  boundPageId:                '1616575215312482' as string | null,
}))

vi.mock('@/lib/meta-oauth/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/meta-oauth/client')>()
  return {
    ...actual,
    verifyState:               mocks.verifyState,
    exchangeCode:              mocks.exchangeCode,
    exchangeForLongLivedToken: mocks.exchangeForLongLivedToken,
    listPagesWithTokens:       mocks.listPagesWithTokens,
    listGrantedScopes:         mocks.listGrantedScopes,
  }
})

vi.mock('@/lib/platform-oauth/connection-store', () => ({
  upsertConnection: (input: Record<string, unknown>) => {
    mocks.upsertCalls.push(input)
    return mocks.upsertConnection(input)
  },
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() =>
            Promise.resolve({ data: { facebook_page_id: mocks.boundPageId }, error: null }),
          ),
        })),
      })),
    })),
  },
}))

// ─── Import after mocks ────────────────────────────────────────────────────────

import { GET } from '../route'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const PAGE_ID = '1616575215312482'

function makeRequest(params: { code?: string; state?: string; error?: string }) {
  const url = new URL('http://localhost:3001/api/auth/facebook/callback')
  if (params.code)  url.searchParams.set('code', params.code)
  if (params.state) url.searchParams.set('state', params.state)
  if (params.error) url.searchParams.set('error', params.error)
  return new NextRequest(url)
}

function outcomeOf(res: NextResponse): string | null {
  const loc = res.headers.get('location') ?? ''
  return new URL(loc).searchParams.get('meta')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.upsertCalls.length = 0
  mocks.boundPageId = PAGE_ID
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.magic-engine.com'
  process.env.FACEBOOK_APP_SECRET = 'app-secret-456'
  mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID })
  mocks.exchangeCode.mockResolvedValue('short-token')
  mocks.exchangeForLongLivedToken.mockResolvedValue('long-token')
  mocks.listPagesWithTokens.mockResolvedValue([
    { pageId: PAGE_ID, pageName: 'CTS Tours', pageToken: 'page-token-xyz' },
  ])
  mocks.listGrantedScopes.mockResolvedValue([
    'pages_show_list',
    'pages_messaging',
    'pages_read_engagement',
    'pages_read_user_content',
    'pages_manage_posts',
  ])
  mocks.upsertConnection.mockResolvedValue(undefined)
})

describe('scope persistence — provider-authoritative, never the requested constant (#1152)', () => {
  it('persists exactly the scopes Meta granted, and stamps last_synced_at', async () => {
    mocks.listGrantedScopes.mockResolvedValue([
      'pages_show_list',
      'pages_messaging',
      'pages_manage_posts',
    ])

    await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(mocks.upsertCalls).toHaveLength(1)
    const row = mocks.upsertCalls[0]
    expect(row.scopes).toEqual(['pages_show_list', 'pages_messaging', 'pages_manage_posts'])
    // last_synced_at must be freshly set — the SCOUT flagged its null-forever
    // state as "readiness never re-verified".
    expect(row.lastSyncedAt).toBeInstanceOf(Date)
  })

  it('does not drop the existing read/inbox scopes when publishing is added', async () => {
    // A full grant round-trips intact — nothing silently trimmed.
    const full = [
      'pages_show_list',
      'pages_messaging',
      'pages_read_engagement',
      'pages_read_user_content',
      'pages_manage_posts',
    ]
    mocks.listGrantedScopes.mockResolvedValue(full)

    await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(mocks.upsertCalls[0].scopes).toEqual(full)
  })

  it('falls back to the requested constant only when the permissions read fails (transient) — never wipes a good grant', async () => {
    mocks.listGrantedScopes.mockResolvedValue(null) // read failed

    await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    // Fallback preserves the connection rather than storing [] and breaking inbox.
    expect((mocks.upsertCalls[0].scopes as string[]).length).toBeGreaterThan(0)
    expect(mocks.upsertCalls[0].scopes).toContain('pages_show_list')
  })
})

describe('publishing reauthorisation fails closed (#1152)', () => {
  it('reports publish_ready only when the provider authoritatively granted pages_manage_posts', async () => {
    mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID, intent: 'publishing' })
    mocks.listGrantedScopes.mockResolvedValue([
      'pages_show_list',
      'pages_manage_posts',
    ])

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(outcomeOf(res)).toBe('publish_ready')
  })

  it('reports publish_not_granted AND stores scopes without pages_manage_posts when Meta declines it', async () => {
    mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID, intent: 'publishing' })
    mocks.listGrantedScopes.mockResolvedValue([
      'pages_show_list',
      'pages_messaging',
      'pages_read_engagement',
    ]) // publishing declined

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(outcomeOf(res)).toBe('publish_not_granted')
    // The stored truth must exclude the declined permission — no publish-ready lie.
    expect(mocks.upsertCalls[0].scopes).not.toContain('pages_manage_posts')
  })

  it('reports publish_not_granted when the permissions read failed — an unproven grant is not a granted one', async () => {
    mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID, intent: 'publishing' })
    mocks.listGrantedScopes.mockResolvedValue(null)

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))

    expect(outcomeOf(res)).toBe('publish_not_granted')
  })

  it('an inbox connect (no intent) is unaffected — still lands on connected', async () => {
    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))
    expect(outcomeOf(res)).toBe('connected')
  })
})

describe('guards — a rejected callback must write nothing and leak nothing', () => {
  it('a forged/expired state never reaches token exchange or a DB write', async () => {
    mocks.verifyState.mockReturnValue(null)

    const res = await GET(makeRequest({ code: 'auth-code', state: 'tampered' }))

    expect(outcomeOf(res)).toBe('bad_state')
    expect(mocks.exchangeCode).not.toHaveBeenCalled()
    expect(mocks.upsertCalls).toHaveLength(0)
  })

  it('a cancelled consent lands on denied without any exchange', async () => {
    const res = await GET(makeRequest({ error: 'access_denied' }))
    expect(outcomeOf(res)).toBe('denied')
    expect(mocks.exchangeCode).not.toHaveBeenCalled()
  })

  it('never puts a token or secret in the redirect the browser follows', async () => {
    mocks.verifyState.mockReturnValue({ clientId: CLIENT_ID, intent: 'publishing' })

    const res = await GET(makeRequest({ code: 'auth-code', state: 'sig.state' }))
    const loc = res.headers.get('location') ?? ''

    expect(loc).not.toContain('page-token-xyz')
    expect(loc).not.toContain('long-token')
    expect(loc).not.toContain('app-secret-456')
  })
})
