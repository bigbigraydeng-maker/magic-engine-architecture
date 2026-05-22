import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { requireDashboardClientAccess } from '../client-access'
import { requireSession } from '../require-session'
import { supabaseAdmin } from '@/lib/supabase'

const CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_CLIENT_ID = '22222222-2222-4222-8222-222222222222'
const KEYS = ['ADMIN_EMAILS', 'ADMIN_EMAIL_DOMAIN', 'CLIENT_VIEWERS'] as const

const mockRequireSession = vi.mocked(requireSession)
const mockFrom = vi.mocked(supabaseAdmin.from)

function mockUser(email: string) {
  mockRequireSession.mockResolvedValue({
    ok: true,
    user: { id: 'user-1', email },
  } as Awaited<ReturnType<typeof requireSession>>)
}

function mockPortalRows(rows: Array<{ client_id: string }>, error: unknown = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data: rows, error }),
  }
  mockFrom.mockReturnValue(chain as unknown as ReturnType<typeof supabaseAdmin.from>)
  return chain
}

describe('requireDashboardClientAccess', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    vi.resetAllMocks()
    for (const key of KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  it('returns 401 when there is no Magic Link session', async () => {
    mockRequireSession.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Unauthorized',
    })

    const result = await requireDashboardClientAccess(CLIENT_ID)

    expect(result).toEqual({ ok: false, status: 401, error: 'Unauthorized' })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('allows admin emails to access any client without a DB lookup', async () => {
    process.env.ADMIN_EMAILS = 'pm@magiclab.com'
    mockUser('pm@magiclab.com')

    const result = await requireDashboardClientAccess(CLIENT_ID)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.role).toBe('admin')
      expect(result.allowedClientId).toBeNull()
    }
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('allows dashboard client access from client_portal_users', async () => {
    mockUser('viewer@example.com')
    mockPortalRows([{ client_id: CLIENT_ID }])

    const result = await requireDashboardClientAccess(CLIENT_ID)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.role).toBe('client-viewer')
      expect(result.allowedClientId).toBe(CLIENT_ID)
    }
  })

  it('keeps backward-compatible CLIENT_VIEWERS access', async () => {
    process.env.CLIENT_VIEWERS = `viewer@example.com:${CLIENT_ID}`
    mockUser('viewer@example.com')
    mockPortalRows([])

    const result = await requireDashboardClientAccess(CLIENT_ID)

    expect(result.ok).toBe(true)
  })

  it('returns 403 when a viewer asks for another client', async () => {
    mockUser('viewer@example.com')
    mockPortalRows([{ client_id: OTHER_CLIENT_ID }])

    const result = await requireDashboardClientAccess(CLIENT_ID)

    expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' })
  })

  it('fails closed when the permission lookup fails', async () => {
    mockUser('viewer@example.com')
    mockPortalRows([], { message: 'database unavailable' })

    const result = await requireDashboardClientAccess(CLIENT_ID)

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Authorization check failed',
    })
  })
})
