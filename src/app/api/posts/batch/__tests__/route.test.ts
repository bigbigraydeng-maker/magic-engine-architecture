import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { POST } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockFrom = vi.mocked(supabaseAdmin.from)
const CLIENT_A = 'a0000000-0000-0000-0000-000000000000'
const CLIENT_B = 'b0000000-0000-0000-0000-000000000000'

afterEach(() => vi.clearAllMocks())

describe('batch content Post auth', () => {
  it('rejects a mixed-client batch before update when any owner is forbidden', async () => {
    const query: Record<string, ReturnType<typeof vi.fn>> = {}
    query.select = vi.fn(() => query)
    query.in = vi.fn().mockResolvedValue({
      data: [
        { id: 'post-a', client_id: CLIENT_A },
        { id: 'post-b', client_id: CLIENT_B },
      ],
      error: null,
    })
    query.update = vi.fn(() => query)
    mockFrom.mockReturnValue(query as never)
    mockAccess
      .mockResolvedValueOnce({ ok: true, tier: 'paid_client' } as never)
      .mockResolvedValueOnce({ ok: false, status: 403, error: 'Forbidden' } as never)

    const response = await POST(new NextRequest('http://localhost/api/posts/batch', {
      method: 'POST',
      body: JSON.stringify({ post_ids: ['post-a', 'post-b'], action: 'updateStatus', status: 'approved' }),
    }))
    expect(response.status).toBe(403)
    expect(query.update).not.toHaveBeenCalled()
  })
})
