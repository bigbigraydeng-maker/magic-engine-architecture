/**
 * TDD — RED Phase
 * Tests for error message sanitisation in blog API routes.
 *
 * Covers HIGH-3: Error messages in HTTP responses must NOT reveal internal
 * database schema details (table names, column names, constraint names, etc.)
 * Detailed error context is only logged server-side.
 *
 * Reference: Phase 7.3 security fix
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock('@/lib/blog/generator', () => ({
  generateBlogPost: vi.fn(),
}))

vi.mock('@/lib/blog/content-auditor', () => ({
  auditExistingContent: vi.fn(),
}))

vi.mock('@/lib/blog/topic-selector', () => ({
  getWeakSpotOpportunities: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { GET as blogListGET, POST as blogListPOST } from '../route'
import { GET as opportunitiesGET } from '../opportunities/route'
import { GET as postDetailGET, PATCH as postDetailPATCH, DELETE as postDetailDELETE } from '../[postId]/route'
import { supabaseAdmin } from '@/lib/supabase'
import { generateBlogPost } from '@/lib/blog/generator'
import { getWeakSpotOpportunities } from '@/lib/blog/topic-selector'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'http://localhost:3000'
const VALID_TOKEN = 'test-internal-key-secret'

function makeAuthedRequest(
  path: string,
  options: { method?: string; body?: unknown } = {}
): NextRequest {
  const initOptions: Record<string, unknown> = {
    method: options.method ?? 'GET',
    headers: { Authorization: `Bearer ${VALID_TOKEN}` },
  }
  if (options.body) {
    initOptions.body = JSON.stringify(options.body)
  }
  return new NextRequest(`${BASE_URL}${path}`, initOptions as any)
}

/** Patterns that indicate internal schema leakage */
const SCHEMA_LEAK_PATTERNS = [
  /blog_posts/,
  /content_posts/,
  /client_id/,
  /source_query_id/,
  /geo_directive_id/,
  /html_body/,
  /word_count/,
  /constraint/i,
  /violates/i,
  /foreign key/i,
  /unique constraint/i,
  /null value in column/i,
  /duplicate key/i,
]

function assertNoSchemaLeak(body: Record<string, unknown>): void {
  const errorText = typeof body.error === 'string' ? body.error : ''
  for (const pattern of SCHEMA_LEAK_PATTERNS) {
    expect(errorText).not.toMatch(pattern)
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const mockFrom = vi.mocked(supabaseAdmin.from)
const mockGenerateBlogPost = vi.mocked(generateBlogPost)
const mockGetWeakSpotOpportunities = vi.mocked(getWeakSpotOpportunities)

beforeEach(() => {
  process.env.INTERNAL_API_KEY = VALID_TOKEN
  vi.resetAllMocks()

  // Default: supabase chain that can be overridden per test
  const mockChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  }
  mockFrom.mockReturnValue(mockChain as any)
})

// ---------------------------------------------------------------------------
// Tests: GET blog list — database error sanitisation
// ---------------------------------------------------------------------------

describe('GET /api/clients/[id]/blog — database error sanitisation', () => {
  const params = { id: 'client-1' }

  it('returns generic error message when Supabase returns a DB error', async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: null,
        error: {
          message: 'relation "blog_posts" does not exist',
          code: '42P01',
        },
      }),
    }
    mockFrom.mockReturnValue(mockChain as any)

    const req = makeAuthedRequest('/api/clients/client-1/blog')
    const res = await blogListGET(req, { params })
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.success).toBe(false)
    assertNoSchemaLeak(body)
  })

  it('returns generic error when Supabase returns a constraint violation message', async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: null,
        error: {
          message: 'null value in column "client_id" violates not-null constraint',
          code: '23502',
        },
      }),
    }
    mockFrom.mockReturnValue(mockChain as any)

    const req = makeAuthedRequest('/api/clients/client-1/blog')
    const res = await blogListGET(req, { params })
    const body = await res.json()

    expect(body.success).toBe(false)
    assertNoSchemaLeak(body)
  })
})

// ---------------------------------------------------------------------------
// Tests: POST blog — database error sanitisation
// ---------------------------------------------------------------------------

describe('POST /api/clients/[id]/blog — database error sanitisation', () => {
  const params = { id: 'client-1' }

  it('does not expose DB schema in error when insert fails', async () => {
    // Mock generateBlogPost to succeed
    mockGenerateBlogPost.mockResolvedValue({
      title: 'Test Title',
      meta_title: 'Test Meta Title',
      meta_description: 'Test meta description',
      slug: 'test-title',
      html_body: '<p>Content</p>',
      word_count: 100,
      geo_directive_id: null,
      geo_html_snapshot: null,
      featured_image_prompt: 'hero image prompt',
      cost_usd: 0.01,
      model_used: 'gpt-4o-mini',
    })

    // Mock clients query (for domain lookup)
    const clientChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    // First call = clients query; second call = insert
    const insertChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: {
          message: 'duplicate key value violates unique constraint "blog_posts_slug_key"',
          code: '23505',
        },
      }),
    }

    mockFrom
      .mockReturnValueOnce(clientChain as any)
      .mockReturnValueOnce(insertChain as any)

    const req = makeAuthedRequest('/api/clients/client-1/blog', {
      method: 'POST',
      body: { topic: 'china tours', mode: 'geo_only', skip_audit: true },
    })
    const res = await blogListPOST(req, { params })
    const body = await res.json()

    expect(body.success).toBe(false)
    assertNoSchemaLeak(body)
  })
})

// ---------------------------------------------------------------------------
// Tests: GET /blog/[postId] — error sanitisation
// ---------------------------------------------------------------------------

describe('GET /api/clients/[id]/blog/[postId] — error sanitisation', () => {
  const params = { id: 'client-1', postId: 'post-abc' }

  it('returns 404 with generic message when post not found (not DB details)', async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'relation "blog_posts" does not exist' },
      }),
    }
    mockFrom.mockReturnValue(mockChain as any)

    const req = makeAuthedRequest('/api/clients/client-1/blog/post-abc')
    const res = await postDetailGET(req, { params })
    const body = await res.json()

    expect(body.success).toBe(false)
    // Error message must be generic
    expect(body.error).toBe('Post not found')
    assertNoSchemaLeak(body)
  })
})

// ---------------------------------------------------------------------------
// Tests: PATCH /blog/[postId] — error sanitisation
// ---------------------------------------------------------------------------

describe('PATCH /api/clients/[id]/blog/[postId] — error sanitisation', () => {
  const params = { id: 'client-1', postId: 'post-abc' }

  it('returns generic error when update fails due to DB constraint', async () => {
    const mockChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: {
          message: 'null value in column "html_body" violates not-null constraint',
          code: '23502',
        },
      }),
    }
    mockFrom.mockReturnValue(mockChain as any)

    const req = makeAuthedRequest('/api/clients/client-1/blog/post-abc', {
      method: 'PATCH',
      body: { status: 'approved' },
    })
    const res = await postDetailPATCH(req, { params })
    const body = await res.json()

    expect(body.success).toBe(false)
    assertNoSchemaLeak(body)
  })
})

// ---------------------------------------------------------------------------
// Tests: DELETE /blog/[postId] — error sanitisation
// ---------------------------------------------------------------------------

describe('DELETE /api/clients/[id]/blog/[postId] — error sanitisation', () => {
  const params = { id: 'client-1', postId: 'post-abc' }

  it('returns generic error when delete fails', async () => {
    const mockChain = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      // Resolves with an error
      then: undefined, // no extra chaining
    }
    // Make the whole chain return an error
    const deleteChain = {
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            error: {
              message: 'foreign key constraint "blog_posts_client_id_fkey" violated',
              code: '23503',
            },
          }),
        }),
      }),
    }
    mockFrom.mockReturnValue(deleteChain as any)

    const req = makeAuthedRequest('/api/clients/client-1/blog/post-abc', { method: 'DELETE' })
    const res = await postDetailDELETE(req, { params })
    const body = await res.json()

    expect(body.success).toBe(false)
    assertNoSchemaLeak(body)
  })
})

// ---------------------------------------------------------------------------
// Tests: GET /blog/opportunities — error sanitisation
// ---------------------------------------------------------------------------

describe('GET /api/clients/[id]/blog/opportunities — error sanitisation', () => {
  const params = { id: 'client-1' }

  it('returns generic error when topic selector throws with DB details', async () => {
    mockGetWeakSpotOpportunities.mockRejectedValue(
      new Error('relation "ai_visibility_runs" does not exist in schema "public"')
    )

    const req = makeAuthedRequest('/api/clients/client-1/blog/opportunities')
    const res = await opportunitiesGET(req, { params })
    const body = await res.json()

    expect(body.success).toBe(false)
    assertNoSchemaLeak(body)
  })
})

// ---------------------------------------------------------------------------
// Tests: limit parameter boundary in GET blog list (HIGH-1 integration)
// ---------------------------------------------------------------------------

describe('GET /api/clients/[id]/blog — limit parameter boundary', () => {
  const params = { id: 'client-1' }

  it('caps limit at 100 for extreme value', async () => {
    let capturedLimit: number | undefined

    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation((n: number) => {
        capturedLimit = n
        return Promise.resolve({ data: [], error: null })
      }),
    }
    mockFrom.mockReturnValue(mockChain as any)

    const req = makeAuthedRequest('/api/clients/client-1/blog?limit=99999')
    const res = await blogListGET(req, { params })

    expect(res.status).not.toBe(401)
    expect(capturedLimit).toBeDefined()
    expect(capturedLimit!).toBeLessThanOrEqual(100)
  })

  it('uses default limit (20) when limit param is absent', async () => {
    let capturedLimit: number | undefined

    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation((n: number) => {
        capturedLimit = n
        return Promise.resolve({ data: [], error: null })
      }),
    }
    mockFrom.mockReturnValue(mockChain as any)

    const req = makeAuthedRequest('/api/clients/client-1/blog')
    await blogListGET(req, { params })

    expect(capturedLimit).toBeDefined()
    expect(capturedLimit!).toBeLessThanOrEqual(100)
    expect(capturedLimit!).toBeGreaterThan(0)
  })

  it('caps limit at 100 for opportunities endpoint', async () => {
    let capturedLimit: number | undefined

    mockGetWeakSpotOpportunities.mockImplementation(async (_clientId, limit) => {
      capturedLimit = limit
      return []
    })

    const req = makeAuthedRequest('/api/clients/client-1/blog/opportunities?limit=9999')
    await opportunitiesGET(req, { params })

    expect(capturedLimit).toBeDefined()
    expect(capturedLimit!).toBeLessThanOrEqual(100)
  })
})
