/**
 * TDD — RED Phase
 * Tests for Bearer token authentication on blog API routes.
 *
 * Covers CRITICAL-1: API routes have no authentication.
 * All blog endpoints must reject requests without a valid INTERNAL_API_KEY token.
 *
 * Reference: Phase 7.3 security fix
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports (hoisting rule)
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockReturnThis(),
    })),
  },
}))

vi.mock('@/lib/blog/generator', () => ({
  generateBlogPost: vi.fn(),
}))

vi.mock('@/lib/blog/content-auditor', () => ({
  auditExistingContent: vi.fn(),
}))

vi.mock('@/lib/blog/topic-selector', () => ({
  getWeakSpotOpportunities: vi.fn().mockResolvedValue([]),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { GET as blogListGET, POST as blogListPOST } from '../route'
import { GET as opportunitiesGET } from '../opportunities/route'
import { GET as postDetailGET, PATCH as postDetailPATCH, DELETE as postDetailDELETE } from '../[postId]/route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'http://localhost:3000'

function makeRequest(
  path: string,
  options: {
    method?: string
    headers?: Record<string, string>
    body?: unknown
  } = {}
): NextRequest {
  const url = `${BASE_URL}${path}`
  const initOptions: Record<string, unknown> = {
    method: options.method ?? 'GET',
    headers: options.headers ?? {},
  }
  if (options.body) {
    initOptions.body = JSON.stringify(options.body)
  }
  return new NextRequest(url, initOptions as any)
}

function makeAuthedRequest(
  path: string,
  options: { method?: string; body?: unknown } = {}
): NextRequest {
  return makeRequest(path, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.INTERNAL_API_KEY}` },
  })
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  process.env.INTERNAL_API_KEY = 'test-internal-key-secret'
})

// ---------------------------------------------------------------------------
// Tests: GET /api/clients/[id]/blog
// ---------------------------------------------------------------------------

describe('GET /api/clients/[id]/blog — authentication', () => {
  const params = { id: 'client-1' }

  it('returns 401 when Authorization header is missing', async () => {
    const req = makeRequest('/api/clients/client-1/blog')
    const res = await blogListGET(req, { params })
    expect(res.status).toBe(401)

    const body = await res.json()
    expect(body.success).toBe(false)
    // Must NOT expose internal details in the error message
    expect(body.error).not.toMatch(/INTERNAL_API_KEY/i)
    expect(body.error).not.toMatch(/environment/i)
  })

  it('returns 401 when Authorization header has wrong token', async () => {
    const req = makeRequest('/api/clients/client-1/blog', {
      headers: { Authorization: 'Bearer wrong-token' },
    })
    const res = await blogListGET(req, { params })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.success).toBe(false)
  })

  it('returns 401 when Authorization header uses wrong scheme', async () => {
    const req = makeRequest('/api/clients/client-1/blog', {
      headers: { Authorization: 'Basic test-internal-key-secret' },
    })
    const res = await blogListGET(req, { params })
    expect(res.status).toBe(401)
  })

  it('returns 401 when token is empty string', async () => {
    const req = makeRequest('/api/clients/client-1/blog', {
      headers: { Authorization: 'Bearer ' },
    })
    const res = await blogListGET(req, { params })
    expect(res.status).toBe(401)
  })

  it('allows request with correct Bearer token', async () => {
    const req = makeAuthedRequest('/api/clients/client-1/blog')
    const res = await blogListGET(req, { params })
    // Should NOT be 401 — any other status means auth passed
    expect(res.status).not.toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Tests: POST /api/clients/[id]/blog
// ---------------------------------------------------------------------------

describe('POST /api/clients/[id]/blog — authentication', () => {
  const params = { id: 'client-1' }

  it('returns 401 when Authorization header is missing', async () => {
    const req = makeRequest('/api/clients/client-1/blog', {
      method: 'POST',
      body: { topic: 'test topic', mode: 'geo_only' },
    })
    const res = await blogListPOST(req, { params })
    expect(res.status).toBe(401)
  })

  it('returns 401 for invalid token on POST', async () => {
    const req = makeRequest('/api/clients/client-1/blog', {
      method: 'POST',
      headers: { Authorization: 'Bearer bad-token' },
      body: { topic: 'test', mode: 'geo_only' },
    })
    const res = await blogListPOST(req, { params })
    expect(res.status).toBe(401)
  })

  it('allows POST with correct token', async () => {
    const req = makeAuthedRequest('/api/clients/client-1/blog', {
      method: 'POST',
      body: { topic: 'china tours nz', mode: 'geo_only' },
    })
    const res = await blogListPOST(req, { params })
    expect(res.status).not.toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Tests: GET /api/clients/[id]/blog/opportunities
// ---------------------------------------------------------------------------

describe('GET /api/clients/[id]/blog/opportunities — authentication', () => {
  const params = { id: 'client-1' }

  it('returns 401 when Authorization header is missing', async () => {
    const req = makeRequest('/api/clients/client-1/blog/opportunities')
    const res = await opportunitiesGET(req, { params })
    expect(res.status).toBe(401)
  })

  it('returns 401 for invalid token', async () => {
    const req = makeRequest('/api/clients/client-1/blog/opportunities', {
      headers: { Authorization: 'Bearer invalid' },
    })
    const res = await opportunitiesGET(req, { params })
    expect(res.status).toBe(401)
  })

  it('allows request with correct token', async () => {
    const req = makeAuthedRequest('/api/clients/client-1/blog/opportunities')
    const res = await opportunitiesGET(req, { params })
    expect(res.status).not.toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Tests: GET /api/clients/[id]/blog/[postId]
// ---------------------------------------------------------------------------

describe('GET /api/clients/[id]/blog/[postId] — authentication', () => {
  const params = { id: 'client-1', postId: 'post-abc' }

  it('returns 401 when Authorization header is missing', async () => {
    const req = makeRequest('/api/clients/client-1/blog/post-abc')
    const res = await postDetailGET(req, { params })
    expect(res.status).toBe(401)
  })

  it('allows request with correct token', async () => {
    const req = makeAuthedRequest('/api/clients/client-1/blog/post-abc')
    const res = await postDetailGET(req, { params })
    expect(res.status).not.toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Tests: PATCH /api/clients/[id]/blog/[postId]
// ---------------------------------------------------------------------------

describe('PATCH /api/clients/[id]/blog/[postId] — authentication', () => {
  const params = { id: 'client-1', postId: 'post-abc' }

  it('returns 401 when Authorization header is missing', async () => {
    const req = makeRequest('/api/clients/client-1/blog/post-abc', {
      method: 'PATCH',
      body: { status: 'approved' },
    })
    const res = await postDetailPATCH(req, { params })
    expect(res.status).toBe(401)
  })

  it('allows PATCH with correct token', async () => {
    const req = makeAuthedRequest('/api/clients/client-1/blog/post-abc', {
      method: 'PATCH',
      body: { status: 'approved' },
    })
    const res = await postDetailPATCH(req, { params })
    expect(res.status).not.toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Tests: DELETE /api/clients/[id]/blog/[postId]
// ---------------------------------------------------------------------------

describe('DELETE /api/clients/[id]/blog/[postId] — authentication', () => {
  const params = { id: 'client-1', postId: 'post-abc' }

  it('returns 401 when Authorization header is missing', async () => {
    const req = makeRequest('/api/clients/client-1/blog/post-abc', { method: 'DELETE' })
    const res = await postDetailDELETE(req, { params })
    expect(res.status).toBe(401)
  })

  it('allows DELETE with correct token', async () => {
    const req = makeAuthedRequest('/api/clients/client-1/blog/post-abc', { method: 'DELETE' })
    const res = await postDetailDELETE(req, { params })
    expect(res.status).not.toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Edge case: INTERNAL_API_KEY not set
// ---------------------------------------------------------------------------

describe('authentication — INTERNAL_API_KEY environment variable missing', () => {
  const params = { id: 'client-1' }

  it('returns 500 (config error) instead of silently accepting all requests', async () => {
    const saved = process.env.INTERNAL_API_KEY
    delete process.env.INTERNAL_API_KEY

    const req = makeRequest('/api/clients/client-1/blog', {
      headers: { Authorization: 'Bearer anything' },
    })
    const res = await blogListGET(req, { params })

    // Must not accidentally allow access when key is missing
    // Acceptable: 401 (treat missing key as auth failure) or 500 (config error)
    expect([401, 500]).toContain(res.status)

    process.env.INTERNAL_API_KEY = saved
  })
})
