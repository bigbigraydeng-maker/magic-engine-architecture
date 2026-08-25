import { beforeEach, describe, expect, it, vi } from 'vitest'

// Capture every call made to Supabase admin.generateLink and every call to
// the underlying sendPortalInvite so we can assert:
//   (a) Supabase gets the allowlisted /auth/callback redirectTo, and
//   (b) the email carries our own /auth/invite-landing?...&client_id=... URL
//       built from properties.hashed_token, not Supabase's action_link.
const generateLinkCalls: Array<{ type: string; email: string; redirectTo: string }> = []
const sendCalls: Array<Record<string, unknown>> = []

const mocks = vi.hoisted(() => ({
  generateLink: vi.fn(),
  sendPortalInvite: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        generateLink: (params: { type: string; email: string; options: { redirectTo: string } }) => {
          generateLinkCalls.push({
            type: params.type,
            email: params.email,
            redirectTo: params.options.redirectTo,
          })
          return mocks.generateLink(params)
        },
      },
    },
  },
}))

vi.mock('@/lib/email/portal-invite', () => ({
  sendPortalInvite: (args: Record<string, unknown>) => {
    sendCalls.push(args)
    return mocks.sendPortalInvite(args)
  },
}))

import { sendPortalInviteForClient } from '../send-portal-invite-for-client'

const APP = 'https://app.magicengine.com.au'
const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'

describe('sendPortalInviteForClient — Supabase redirect allowlist', () => {
  beforeEach(() => {
    process.env.APP_URL = APP
    generateLinkCalls.length = 0
    sendCalls.length = 0
    mocks.generateLink.mockReset()
    mocks.sendPortalInvite.mockReset()
    mocks.sendPortalInvite.mockResolvedValue({ sent: true })
  })

  it('passes the ALLOWLISTED /auth/callback URL to Supabase generateLink (invite path)', async () => {
    mocks.generateLink.mockResolvedValueOnce({
      data: { properties: { hashed_token: 'HASH_INVITE_1' } },
      error: null,
    })

    const res = await sendPortalInviteForClient({
      email: 'staff@cts.co.nz',
      clientId: CLIENT_ID,
      clientName: 'CTS Tours NZ',
      displayName: '小李',
    })

    expect(res.sent).toBe(true)
    expect(generateLinkCalls).toHaveLength(1)
    expect(generateLinkCalls[0].type).toBe('invite')
    expect(generateLinkCalls[0].redirectTo).toBe(`${APP}/auth/callback`)
    // The email must NOT reference /auth/invite-landing as Supabase's
    // redirect — only as the URL WE build for the invitee's click.
    expect(generateLinkCalls[0].redirectTo).not.toContain('/auth/invite-landing')
  })

  it('still emails the ME-owned /auth/invite-landing URL with token/type/client_id', async () => {
    mocks.generateLink.mockResolvedValueOnce({
      data: { properties: { hashed_token: 'HASH_ABC' } },
      error: null,
    })

    await sendPortalInviteForClient({
      email: 'staff@cts.co.nz',
      clientId: CLIENT_ID,
      clientName: 'CTS Tours NZ',
      displayName: '小李',
    })

    expect(sendCalls).toHaveLength(1)
    const action = sendCalls[0].actionLink as string
    expect(action.startsWith(`${APP}/auth/invite-landing?`)).toBe(true)
    const url = new URL(action)
    expect(url.searchParams.get('token_hash')).toBe('HASH_ABC')
    expect(url.searchParams.get('type')).toBe('invite')
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID)
  })

  it('magiclink FALLBACK also uses the allowlisted /auth/callback redirectTo', async () => {
    // First call: invite refuses because the user already exists.
    mocks.generateLink.mockResolvedValueOnce({
      data: null,
      error: { message: 'Email already exists', status: 422, code: 'email_exists' },
    })
    // Second call: magiclink succeeds.
    mocks.generateLink.mockResolvedValueOnce({
      data: { properties: { hashed_token: 'HASH_MAGIC' } },
      error: null,
    })

    const res = await sendPortalInviteForClient({
      email: 'existing@cts.co.nz',
      clientId: CLIENT_ID,
      clientName: 'CTS Tours NZ',
      displayName: '',
    })

    expect(res.sent).toBe(true)
    expect(generateLinkCalls.map(c => c.type)).toEqual(['invite', 'magiclink'])
    // BOTH calls must go to the allowlisted URL — never to /auth/invite-landing.
    for (const call of generateLinkCalls) {
      expect(call.redirectTo).toBe(`${APP}/auth/callback`)
    }
    // Email still carries our own landing URL with the magic-link hashed token.
    const action = sendCalls[0].actionLink as string
    const url = new URL(action)
    expect(url.pathname).toBe('/auth/invite-landing')
    expect(url.searchParams.get('token_hash')).toBe('HASH_MAGIC')
    expect(url.searchParams.get('type')).toBe('magiclink')
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID)
  })

  it('returns sent:false with the Supabase reason when generateLink fails and no fallback applies', async () => {
    // A non-existence error (e.g. rate limit) MUST NOT trigger a magiclink
    // retry, and the caller must see the real reason so it can log/warn.
    mocks.generateLink.mockResolvedValueOnce({
      data: null,
      error: { message: 'over_email_send_rate_limit', status: 429 },
    })

    const res = await sendPortalInviteForClient({
      email: 'staff@cts.co.nz',
      clientId: CLIENT_ID,
      clientName: 'CTS Tours NZ',
      displayName: '',
    })

    expect(res.sent).toBe(false)
    expect(res.reason).toBe('over_email_send_rate_limit')
    // Sanity: still hit the ALLOWLISTED URL — the failure is not
    // because we asked Supabase to redirect somewhere it doesn't allow.
    expect(generateLinkCalls[0].redirectTo).toBe(`${APP}/auth/callback`)
    // No email attempted.
    expect(sendCalls).toHaveLength(0)
  })
})
