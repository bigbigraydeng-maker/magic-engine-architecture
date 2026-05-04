/**
 * Test suite for GET /api/clients/[id]/site-audit/pages/[pageId]
 * Tests permission validation, page existence, and response format
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

describe('GET /api/clients/[id]/site-audit/pages/[pageId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // =========================================================================
  // Client Validation Tests
  // =========================================================================

  describe('Client validation', () => {
    it('should return 404 when client does not exist', async () => {
      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: 'PGRST116', message: 'No rows found' },
            }),
          }),
        }),
      })

      vi.mocked(supabaseAdmin).from = mockFrom

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages/page-1'
      )
      const response = await GET(request, { params: { id: 'client-1', pageId: 'page-1' } })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Client not found')
    })

    it('should return 404 when client has no domain configured', async () => {
      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 'client-1', domain: null },
              error: null,
            }),
          }),
        }),
      })

      vi.mocked(supabaseAdmin).from = mockFrom

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages/page-1'
      )
      const response = await GET(request, { params: { id: 'client-1', pageId: 'page-1' } })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Client has no domain configured')
    })
  })

  // =========================================================================
  // Page Existence & Permission Tests
  // =========================================================================

  describe('Page existence and permission', () => {
    const mockClient = { id: 'client-1', domain: 'example.com' }
    const mockPage: SiteAuditPage = {
      id: 'page-1',
      job_id: 'job-1',
      url: 'https://example.com/blog/post',
      page_type: 'blog',
      topics: ['topic-a', 'topic-b'],
      has_geo_block: true,
      markdown_content: '# Blog Post\n\nContent here.',
      geo_block_info: { directive_id: 'geo-1', strategy: 'location_based' },
      created_at: '2026-05-05T00:00:00Z',
      updated_at: '2026-05-05T00:00:00Z',
    }

    it('should return 404 when page does not exist', async () => {
      const mockFrom = vi.fn()

      // Client lookup
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockClient, error: null }),
          }),
        }),
      })

      // Page lookup fails
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: 'PGRST116', message: 'No rows found' },
            }),
          }),
        }),
      })

      vi.mocked(supabaseAdmin).from = mockFrom

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages/nonexistent-page'
      )
      const response = await GET(request, { params: { id: 'client-1', pageId: 'nonexistent-page' } })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Page not found')
    })

    it('should return 403 when page belongs to different client', async () => {
      const mockFrom = vi.fn()

      // Client lookup succeeds
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockClient, error: null }),
          }),
        }),
      })

      // Page lookup returns page
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: mockPage,
              error: null,
            }),
          }),
        }),
      })

      // Job lookup returns different client's job
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 'job-1', client_id: 'other-client' },
              error: null,
            }),
          }),
        }),
      })

      vi.mocked(supabaseAdmin).from = mockFrom

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages/page-1'
      )
      const response = await GET(request, { params: { id: 'client-1', pageId: 'page-1' } })

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data.error).toBe('Access denied')
    })

    it('should return 200 with page data when page exists and belongs to client', async () => {
      const mockFrom = vi.fn()

      // Client lookup
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockClient, error: null }),
          }),
        }),
      })

      // Page lookup
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: mockPage,
              error: null,
            }),
          }),
        }),
      })

      // Job lookup
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 'job-1', client_id: 'client-1' },
              error: null,
            }),
          }),
        }),
      })

      vi.mocked(supabaseAdmin).from = mockFrom

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages/page-1'
      )
      const response = await GET(request, { params: { id: 'client-1', pageId: 'page-1' } })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.page).toEqual(mockPage)
    })
  })

  // =========================================================================
  // Response Format Tests
  // =========================================================================

  describe('Response format', () => {
    const mockClient = { id: 'client-1', domain: 'example.com' }
    const mockPage: SiteAuditPage = {
      id: 'page-1',
      job_id: 'job-1',
      url: 'https://example.com/blog',
      page_type: 'blog',
      topics: ['topic-a'],
      has_geo_block: true,
      markdown_content: '# Title\n\nContent',
      geo_block_info: { directive_id: 'geo-1', strategy: 'location_based' },
      created_at: '2026-05-05T00:00:00Z',
      updated_at: '2026-05-05T00:00:00Z',
    }

    it('should return correct response structure with all page fields', async () => {
      const mockFrom = vi.fn()

      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockClient, error: null }),
          }),
        }),
      })

      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: mockPage,
              error: null,
            }),
          }),
        }),
      })

      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 'job-1', client_id: 'client-1' },
              error: null,
            }),
          }),
        }),
      })

      vi.mocked(supabaseAdmin).from = mockFrom

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages/page-1'
      )
      const response = await GET(request, { params: { id: 'client-1', pageId: 'page-1' } })

      expect(response.status).toBe(200)
      const data = await response.json()

      expect(data).toHaveProperty('page')
      expect(data.page.id).toBe('page-1')
      expect(data.page.markdown_content).toBeDefined()
      expect(data.page.geo_block_info).toBeDefined()
      expect(typeof data.page.markdown_content).toBe('string')
    })
  })

  // =========================================================================
  // Error Handling Tests
  // =========================================================================

  describe('Error handling', () => {
    const mockClient = { id: 'client-1', domain: 'example.com' }

    it('should return 500 on database query error at page stage', async () => {
      const mockFrom = vi.fn()

      // Client lookup succeeds
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockClient, error: null }),
          }),
        }),
      })

      // Page lookup fails with database error
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database connection failed' },
            }),
          }),
        }),
      })

      vi.mocked(supabaseAdmin).from = mockFrom

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages/page-1'
      )
      const response = await GET(request, { params: { id: 'client-1', pageId: 'page-1' } })

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toBeDefined()
    })

    it('should return 500 on unexpected error', async () => {
      const mockFrom = vi.fn().mockImplementation(() => {
        throw new Error('Unexpected error')
      })

      vi.mocked(supabaseAdmin).from = mockFrom

      const request = new NextRequest(
        'http://localhost:3000/api/clients/client-1/site-audit/pages/page-1'
      )
      const response = await GET(request, { params: { id: 'client-1', pageId: 'page-1' } })

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toBe('Unexpected error')
    })
  })
})
