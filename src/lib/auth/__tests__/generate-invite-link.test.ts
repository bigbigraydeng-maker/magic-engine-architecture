import { describe, it, expect } from 'vitest'
import { generateInviteLink, type InviteLinkAdmin } from '../generate-invite-link'

type Call = { type: 'invite' | 'magiclink'; email: string; redirectTo: string }

function stubAdmin(handlers: {
  invite?: () => Awaited<ReturnType<InviteLinkAdmin['generateLink']>>
  magiclink?: () => Awaited<ReturnType<InviteLinkAdmin['generateLink']>>
}): { admin: InviteLinkAdmin; calls: Call[] } {
  const calls: Call[] = []
  const admin: InviteLinkAdmin = {
    async generateLink(params) {
      calls.push({ type: params.type, email: params.email, redirectTo: params.options.redirectTo })
      if (params.type === 'invite') {
        return handlers.invite?.() ?? {
          data: { properties: { hashed_token: 'default-invite-hash' } },
          error: null,
        }
      }
      return handlers.magiclink?.() ?? {
        data: { properties: { hashed_token: 'default-magic-hash' } },
        error: null,
      }
    },
  }
  return { admin, calls }
}

const REDIRECT = 'https://app.magicengine.com.au/auth/invite-landing'

describe('generateInviteLink', () => {
  it('returns the invite hashed_token when Supabase accepts the new email', async () => {
    const { admin, calls } = stubAdmin({
      invite: () => ({
        data: { properties: { hashed_token: 'abc123' } },
        error: null,
      }),
    })
    const result = await generateInviteLink('new@cts.co.nz', REDIRECT, { client: { auth: { admin } } })
    expect(result.ok).toBe(true)
    expect(result.hashedToken).toBe('abc123')
    expect(result.type).toBe('invite')
    expect(calls).toEqual([{ type: 'invite', email: 'new@cts.co.nz', redirectTo: REDIRECT }])
  })

  it('falls back to a magic link when Supabase returns code:email_exists (new API)', async () => {
    const { admin, calls } = stubAdmin({
      invite: () => ({
        data: null,
        error: { message: 'Email address already exists', status: 422, code: 'email_exists' },
      }),
      magiclink: () => ({
        data: { properties: { hashed_token: 'xyz789' } },
        error: null,
      }),
    })
    const result = await generateInviteLink('existing@cts.co.nz', REDIRECT, { client: { auth: { admin } } })
    expect(result.ok).toBe(true)
    expect(result.hashedToken).toBe('xyz789')
    expect(result.type).toBe('magiclink')
    expect(calls.map(c => c.type)).toEqual(['invite', 'magiclink'])
  })

  it('falls back on the message signal too — older Supabase without a structured code', async () => {
    const { admin } = stubAdmin({
      invite: () => ({
        data: null,
        error: { message: 'Email has already been registered', status: 422 },
      }),
    })
    const result = await generateInviteLink('e@x.co', REDIRECT, { client: { auth: { admin } } })
    expect(result.ok).toBe(true)
    expect(result.hashedToken).toBe('default-magic-hash')
    expect(result.type).toBe('magiclink')
  })

  it('does NOT fall back on a bare 422 without an "already" message — that could be bad-email or rate-limit', async () => {
    // Supabase reuses 422 for "signup disabled", "bad email format" and rate
    // limits. A blind fallback would try magiclink for addresses that never
    // should have been invited in the first place.
    const { admin, calls } = stubAdmin({
      invite: () => ({
        data: null,
        error: { message: 'Signups not allowed for otp', status: 422 },
      }),
    })
    const result = await generateInviteLink('e@x.co', REDIRECT, { client: { auth: { admin } } })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('Signups not allowed for otp')
    expect(calls.map(c => c.type)).toEqual(['invite'])
  })

  it('does NOT fall back on non-existence errors like rate limiting (429)', async () => {
    const { admin, calls } = stubAdmin({
      invite: () => ({
        data: null,
        error: { message: 'over_email_send_rate_limit', status: 429 },
      }),
    })
    const result = await generateInviteLink('e@x.co', REDIRECT, { client: { auth: { admin } } })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('over_email_send_rate_limit')
    expect(calls.map(c => c.type)).toEqual(['invite'])
  })

  it('treats a null properties block as "no token" instead of returning hashedToken:undefined', async () => {
    const { admin } = stubAdmin({
      invite: () => ({ data: { properties: null }, error: null }),
    })
    const result = await generateInviteLink('e@x.co', REDIRECT, { client: { auth: { admin } } })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/hashed_token/)
  })

  it('reports the magic-link error when the fallback also fails', async () => {
    const { admin } = stubAdmin({
      invite: () => ({ data: null, error: { message: 'User already registered', status: 422 } }),
      magiclink: () => ({ data: null, error: { message: 'user disabled' } }),
    })
    const result = await generateInviteLink('e@x.co', REDIRECT, { client: { auth: { admin } } })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('user disabled')
  })
})
