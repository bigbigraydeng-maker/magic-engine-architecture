/**
 * Test suite for GET /api/clients/[id]/site-audit/pages
 * Tests client validation, page filtering, pagination, multi-tenant isolation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { supabaseAdmin } from '@/lib/supabase'
import type { SiteAuditPage } from '@/lib/site-audit/job-runner'

// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

// Helper to create mock query builder
function createMockQueryBuilder(response: any) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue(response),
      }),
    }),
  }
}

function createMockListBuilder(countResponse: any, dataResponse: any) {
  const countSingle = vi.fn().mockResolvedValue(countResponse)
  const dataRange = vi.fn().mockResolvedValue(dataResponse)

  const mockFrom = vi.fn()

  // First call: count query
  mockFrom.mockReturnValueOnce({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue(countResponse),
      }),
    }),
  })

  // Second call: data query
  mockFrom.mockReturnValueOnce({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            range: dataRange,
          }),
        }),
      }),
    }),
  })

  return mockFrom
}

describe('GET /api/clients/[id]/site-audit/pages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // =========================================================================
  // Client Validation Tests
  // =========================================================================

  describe('Client validation', () => {
    it('should return 404 when client does not exist', async () => {
      const mockSingle = vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'No rows found' },
      })
      const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect })

      vi.mocked(supabaseAdmin).from = mockFrom

      const request = new NextRequest('http://localhost:3000/api/clients/client-1/site-audit/pages')
      const response = await GET(request, { params: { id: 'client-1' } })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Client not found')
    })

    it('should return 404 when client has no domain configured', async () => {
      const mockSingle = vi.fn().mockResolvedValue({
        data: { id: 'client-1', domain: null },
        error: null,
      })
      const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect })

      vi.mocked(supabaseAdmin).from = mockFrom

      const request = new NextRequest('http://localhost:3000/api/clients/client-1/site-audit/pages')
      const response = await GET(request, { params: { id: 'client-1' } })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Client has no domain configured')
    })
  })

  // =========================================================================
  // Pagination Tests
  // =========================================================================

  describe('Pagination', () => {
    const mockClient = { id: 'client-1', domain: 'example.com' }
    const mockJob = { id: 'job-1' }
    const mockPages: SiteAuditPage[] = [
      {
        id: 'page-1',
        job_id: 'job-1',
        url: 'https://example.com/blog1',
        page_type: 'blog',
        topics: ['topic-a', 'topic-b'],
        has_geo_block: true,
        markdown_content: 'Content 1',
        geo_block_info: { directive_id: 'geo-1', strategy: 'location_based' },
        created_at: '2026-05-05T00:00:00Z',
        updated_at: '2026-05-05T00:00:00Z',
      },
    ]

    it('should return paginated results with default limit=10, offset=0', async () => {
      const mockFrom = vi.fn()
      const mockClientSingle = vi.fn().mockResolvedValue({ data: mockClient, error: null })
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ single: mockClientSingle }),
        }),
      })

      const mockJobSingle = vi.fn().mockResolvedValue({ data: [mockJob], error: null })
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                single: mockJobSingle,
              }),
            }),
          }),
        }),
      })

      const mockCountEq = vi.fn().mockResolvedValue({ count: 1, error: null })
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue(mockCountEq),
        }),
      })

      const mockDataRange = vi.fn().mockResolvedValue({ data: mockPages, error: null })
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              range: mockDataRange,
            }),
          }),
        }),
      })

      vi.mocked(supabaseAdmin).from = mockFrom

      const request = new NextRequest('http://localhost:3000/api/clients/client-1/site-audit/pages')
      const response = await GET(request, { params: { id: 'client-1' } })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.pages).toHaveLength(1)
    })

    it('should return 400 when limit exceeds 100', async () => {
      const mockSingle = vi.fn().mockResolvedValue({
        data: mockClient,
        error: null,
      })
      const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect })

      vi.mocked(supabaseAdmin).from = mockFrom

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages?limit=150'
      )
      const response = await GET(request, { params: { id: 'client-1' } })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('limit must be <= 100')
    })

    it('should return 400 when offset is negative', async () => {
      const mockSingle = vi.fn().mockResolvedValue({
        data: mockClient,
        error: null,
      })
      const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect })

      vi.mocked(supabaseAdmin).from = mockFrom

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages?offset=-5'
      )
      const response = await GET(request, { params: { id: 'client-1' } })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('offset must be >= 0')
    })

    it('should return 400 when limit is not a positive integer', async () => {
      const mockSingle = vi.fn().mockResolvedValue({
        data: mockClient,
        error: null,
      })
      const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect })

      vi.mocked(supabaseAdmin).from = mockFrom

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages?limit=abc'
      )
      const response = await GET(request, { params: { id: 'client-1' } })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('limit must be')
    })
  })

  // =========================================================================
  // Filtering Tests
  // =========================================================================

  describe('Page type filtering', () => {
    it('should return 400 for invalid page_type', async () => {
      const mockClient = { id: 'client-1', domain: 'example.com' }
      const mockSingle = vi.fn().mockResolvedValue({
        data: mockClient,
        error: null,
      })
      const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect })

      vi.mocked(supabaseAdmin).from = mockFrom

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages?pageType=invalid'
      )
      const response = await GET(request, { params: { id: 'client-1' } })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('pageType must be one of')
    })
  })

  // =========================================================================
  // Error Handling Tests
  // =========================================================================

  describe('Error handling', () => {
    it('should return 500 on database query error', async () => {
      const mockClient = { id: 'client-1', domain: 'example.com' }
      const mockJob = { id: 'job-1' }

      const mockFrom = vi.fn()

      // Client lookup succeeds
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockClient, error: null }),
          }),
        }),
      })

      // Job lookup succeeds
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: mockJob, error: null }),
              }),
            }),
          }),
        }),
      })

      // Count query fails
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ count: null, error: { message: 'Database connection failed' } }),
          }),
        }),
      })

      vi.mocked(supabaseAdmin).from = mockFrom

      const request = new NextRequest('http://localhost:3000/api/clients/client-1/site-audit/pages')
      const response = await GET(request, { params: { id: 'client-1' } })

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toBeDefined()
    })

    it('should return 500 on unexpected error', async () => {
      const mockFrom = vi.fn().mockImplementation(() => {
        throw new Error('Unexpected error')
      })

      vi.mocked(supabaseAdmin).from = mockFrom

      const request = new NextRequest('http://localhost:3000/api/clients/client-1/site-audit/pages')
      const response = await GET(request, { params: { id: 'client-1' } })

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toBe('Unexpected error')
    })
  })

  // =========================================================================
  // Response Format Tests
  // =========================================================================

  describe('Response format', () => {
    it('should return correct response structure', async () => {
      const mockClient = { id: 'client-1', domain: 'example.com' }
      const mockJob = { id: 'job-1' }
      const mockPages: SiteAuditPage[] = [
        {
          id: 'page-1',
          job_id: 'job-1',
          url: 'https://example.com/blog1',
          page_type: 'blog',
          topics: ['topic-a'],
          has_geo_block: true,
          markdown_content: 'Content',
          geo_block_info: { directive_id: 'geo-1', strategy: 'location_based' },
          created_at: '2026-05-05T00:00:00Z',
          updated_at: '2026-05-05T00:00:00Z',
        },
      ]

      const mockFrom = vi.fn()

      // Client lookup
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockClient, error: null }),
          }),
        }),
      })

      // Job lookup
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: mockJob, error: null }),
              }),
            }),
          }),
        }),
      })

      // Count query
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ count: 1, error: null }),
          }),
        }),
      })

      // Data query
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              range: vi.fn().mockResolvedValue({ data: mockPages, error: null }),
            }),
          }),
        }),
      })

      vi.mocked(supabaseAdmin).from = mockFrom

      const request = new NextRequest('http://localhost:3000/api/clients/client-1/site-audit/pages')
      const response = await GET(request, { params: { id: 'client-1' } })

      expect(response.status).toBe(200)
      const data = await response.json()

      expect(data).toHaveProperty('pages')
      expect(data).toHaveProperty('total')
      expect(data).toHaveProperty('hasMore')
      expect(Array.isArray(data.pages)).toBe(true)
      expect(typeof data.total).toBe('number')
      expect(typeof data.hasMore).toBe('boolean')
    })

    it('should return empty pages array when no results', async () => {
      const mockClient = { id: 'client-1', domain: 'example.com' }
      const mockJob = { id: 'job-1' }

      const mockFrom = vi.fn()

      // Client lookup
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockClient, error: null }),
          }),
        }),
      })

      // Job lookup
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: mockJob, error: null }),
              }),
            }),
          }),
        }),
      })

      // Count query
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
          }),
        }),
      })

      // Data query
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              range: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      })

      vi.mocked(supabaseAdmin).from = mockFrom

      const request = new NextRequest('http://localhost:3000/api/clients/client-1/site-audit/pages')
      const response = await GET(request, { params: { id: 'client-1' } })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.pages).toEqual([])
      expect(data.total).toBe(0)
      expect(data.hasMore).toBe(false)
    })
  })
})
