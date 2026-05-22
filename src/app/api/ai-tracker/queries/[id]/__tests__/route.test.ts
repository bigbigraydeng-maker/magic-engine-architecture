import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { PATCH } from '../route'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

const QUERY_ID = 'query-1'
const CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const mockRequireDashboardClientAccess = vi.mocked(requireDashboardClientAccess)
const mockFrom = vi.mocked(supabaseAdmin.from)

function request(body: unknown) {
  return new NextRequest(`http://localhost:3001/api/ai-tracker/queries/${QUERY_ID}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function mockLookup(clientId: string) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { client_id: clientId },
      error: null,
    }),
  }
  return chain
}

describe('PATCH /api/ai-tracker/queries/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns 403 before updating when the session cannot access the query client', async () => {
    const lookup = mockLookup(CLIENT_ID)
    const update = vi.fn()
    mockFrom.mockReturnValue({
      ...lookup,
      update,
    } as unknown as ReturnType<typeof supabaseAdmin.from>)
    mockRequireDashboardClientAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })

    const res = await PATCH(request({ enabled: false }), { params: { id: QUERY_ID } })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toEqual({ success: false, error: 'Forbidden' })
    expect(mockRequireDashboardClientAccess).toHaveBeenCalledWith(CLIENT_ID)
    expect(update).not.toHaveBeenCalled()
  })

  it('updates only within the authorized client scope', async () => {
    const lookup = mockLookup(CLIENT_ID)
    const updateEq = vi.fn().mockReturnThis()
    const updateChain = {
      update: vi.fn().mockReturnThis(),
      eq: updateEq,
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: QUERY_ID, client_id: CLIENT_ID, enabled: false },
        error: null,
      }),
    }

    mockFrom
      .mockReturnValueOnce(lookup as unknown as ReturnType<typeof supabaseAdmin.from>)
      .mockReturnValueOnce(updateChain as unknown as ReturnType<typeof supabaseAdmin.from>)
    mockRequireDashboardClientAccess.mockResolvedValue({
      ok: true,
      user: { id: 'user-1', email: 'pm@magiclab.com' },
      role: 'admin',
      allowedClientId: null,
    } as Awaited<ReturnType<typeof requireDashboardClientAccess>>)

    const res = await PATCH(request({ enabled: false }), { params: { id: QUERY_ID } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(updateEq).toHaveBeenCalledWith('id', QUERY_ID)
    expect(updateEq).toHaveBeenCalledWith('client_id', CLIENT_ID)
  })
})
