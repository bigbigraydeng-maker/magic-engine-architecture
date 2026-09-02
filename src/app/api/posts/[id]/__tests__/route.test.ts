import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { GET, PATCH } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockFrom = vi.mocked(supabaseAdmin.from)
const CLIENT = 'c0000000-0000-0000-0000-000000000000'

function ownerQuery(data: unknown) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ['select', 'eq', 'not', 'order', 'limit']) {
    query[method] = vi.fn(() => query)
  }
  query.maybeSingle = vi.fn().mockResolvedValue({ data, error: null })
  query.update = vi.fn(() => query)
  return query
}

afterEach(() => vi.clearAllMocks())

describe('single content Post auth', () => {
  it('does not return a Post after its owner access check fails', async () => {
    const posts = ownerQuery({ id: 'post-1', client_id: CLIENT, title: 'Private' })
    mockFrom.mockReturnValue(posts as never)
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)

    const response = await GET(new NextRequest('http://localhost/api/posts/post-1'), { params: { id: 'post-1' } })
    expect(response.status).toBe(403)
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })

  it('does not mutate a Post after its owner access check fails', async () => {
    const posts = ownerQuery({ client_id: CLIENT })
    mockFrom.mockReturnValue(posts as never)
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)

    const response = await PATCH(new NextRequest('http://localhost/api/posts/post-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'approved' }),
    }), { params: { id: 'post-1' } })
    expect(response.status).toBe(403)
    expect(posts.update).not.toHaveBeenCalled()
  })

  it('rejects an execution-item link that does not resolve under the Post owner', async () => {
    const posts = ownerQuery({ client_id: CLIENT })
    const executionItems = ownerQuery(null)
    mockFrom.mockImplementation((table: string) => (
      table === 'content_posts' ? posts : executionItems
    ) as never)
    mockAccess.mockResolvedValue({ ok: true, tier: 'paid_client' } as never)

    const response = await PATCH(new NextRequest('http://localhost/api/posts/post-1', {
      method: 'PATCH',
      body: JSON.stringify({ execution_item_id: 'foreign-item' }),
    }), { params: { id: 'post-1' } })
    expect(response.status).toBe(404)
    expect(executionItems.eq).toHaveBeenCalledWith('client_id', CLIENT)
    expect(posts.update).not.toHaveBeenCalled()
  })

  it('scopes the selected visual asset to the same client as the Post', async () => {
    const posts = ownerQuery({ id: 'post-1', client_id: CLIENT, title: 'Private' })
    const visuals = ownerQuery(null)
    mockFrom.mockImplementation((table: string) => (
      table === 'content_posts' ? posts : visuals
    ) as never)
    mockAccess.mockResolvedValue({ ok: true, tier: 'paid_client' } as never)

    const response = await GET(new NextRequest('http://localhost/api/posts/post-1'), { params: { id: 'post-1' } })
    expect(response.status).toBe(200)
    expect(visuals.eq).toHaveBeenCalledWith('client_id', CLIENT)
    expect((await response.json()).post.visual_asset_url).toBeNull()
  })
})
