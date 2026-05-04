/**
 * GET /api/clients/[id]/site-audit/pages
 *
 * Returns paginated list of crawled pages for a site-audit job.
 *
 * Query Parameters:
 * - limit (optional): Max results per page. Must be 1-100. Default: 10
 * - offset (optional): Results to skip. Must be >= 0. Default: 0
 * - pageType (optional): Filter by page type: 'blog', 'landing', 'product'
 * - topics (optional): Comma-separated topic IDs. Matches pages with ANY topic (OR).
 * - hasGeoBlock (optional): Filter by GEO block presence: 'true' or 'false'
 *
 * Response:
 * {
 *   pages: SiteAuditPage[],      // Array of page records
 *   total: number,               // Total count of matching pages
 *   hasMore: boolean             // Whether more pages exist beyond this batch
 * }
 *
 * Reference: ROADMAP.md P8.0.5.4
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type { SiteAuditPage } from '@/lib/site-audit/job-runner'

// Allow up to 60 seconds
export const maxDuration = 60

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PagesResponse {
  pages: SiteAuditPage[]
  total: number
  hasMore: boolean
}

export interface ApiErrorResponse {
  error: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 100
const VALID_PAGE_TYPES = ['blog', 'landing', 'product']

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validatePaginationParams(
  limit?: string | null,
  offset?: string | null
): { valid: true; limit: number; offset: number } | { valid: false; error: string } {
  // Parse limit
  const parsedLimit = limit ? parseInt(limit, 10) : DEFAULT_LIMIT
  if (isNaN(parsedLimit) || parsedLimit < 1) {
    return { valid: false, error: 'limit must be a positive integer' }
  }
  if (parsedLimit > MAX_LIMIT) {
    return { valid: false, error: `limit must be <= ${MAX_LIMIT}` }
  }

  // Parse offset
  const parsedOffset = offset ? parseInt(offset, 10) : 0
  if (isNaN(parsedOffset) || parsedOffset < 0) {
    return { valid: false, error: 'offset must be >= 0' }
  }

  return { valid: true, limit: parsedLimit, offset: parsedOffset }
}

function validatePageType(
  pageType?: string | null
): { valid: true; pageType: string } | { valid: false; error: string } {
  if (!pageType) {
    return { valid: true, pageType: '' } // No filter
  }
  if (!VALID_PAGE_TYPES.includes(pageType)) {
    return {
      valid: false,
      error: `pageType must be one of: ${VALID_PAGE_TYPES.join(', ')}`,
    }
  }
  return { valid: true, pageType }
}

function validateHasGeoBlock(
  hasGeoBlock?: string | null
): { valid: true; hasGeoBlock: boolean | null } | { valid: false; error: string } {
  if (!hasGeoBlock) {
    return { valid: true, hasGeoBlock: null } // No filter
  }
  if (hasGeoBlock !== 'true' && hasGeoBlock !== 'false') {
    return { valid: false, error: 'hasGeoBlock must be "true" or "false"' }
  }
  return { valid: true, hasGeoBlock: hasGeoBlock === 'true' }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse<PagesResponse | ApiErrorResponse>> {
  const clientId = params.id
  const { searchParams } = new URL(request.url)

  try {
    // 1. Verify client exists and has a domain
    const { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .select('id, domain')
      .eq('id', clientId)
      .single()

    if (clientError || !client) {
      return NextResponse.json<ApiErrorResponse>(
        { error: 'Client not found' },
        { status: 404 }
      )
    }

    if (!client.domain) {
      return NextResponse.json<ApiErrorResponse>(
        { error: 'Client has no domain configured' },
        { status: 404 }
      )
    }

    // 2. Validate pagination parameters
    const paginationValidation = validatePaginationParams(
      searchParams.get('limit'),
      searchParams.get('offset')
    )
    if ('error' in paginationValidation) {
      return NextResponse.json<ApiErrorResponse>(
        { error: paginationValidation.error },
        { status: 400 }
      )
    }
    const { limit, offset } = paginationValidation

    // 3. Validate filter parameters
    const pageTypeValidation = validatePageType(searchParams.get('pageType'))
    if ('error' in pageTypeValidation) {
      return NextResponse.json<ApiErrorResponse>(
        { error: pageTypeValidation.error },
        { status: 400 }
      )
    }
    const { pageType } = pageTypeValidation

    const hasGeoBlockValidation = validateHasGeoBlock(searchParams.get('hasGeoBlock'))
    if ('error' in hasGeoBlockValidation) {
      return NextResponse.json<ApiErrorResponse>(
        { error: hasGeoBlockValidation.error },
        { status: 400 }
      )
    }
    const { hasGeoBlock } = hasGeoBlockValidation

    // Parse topics (comma-separated)
    const topicsParam = searchParams.get('topics')
    const topics = topicsParam ? topicsParam.split(',').filter((t) => t.trim()) : []

    // 4. Get the latest job for this client (to scope pages)
    const { data: job, error: jobError } = await supabaseAdmin
      .from('site_audit_jobs')
      .select('id')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    // If no job found, return empty results
    if (jobError || !job) {
      return NextResponse.json<PagesResponse>(
        {
          pages: [],
          total: 0,
          hasMore: false,
        },
        { status: 200 }
      )
    }

    // 5. Build count query
    let countQuery = supabaseAdmin
      .from('site_audit_pages')
      .select('*', { count: 'exact', head: true })
      .eq('job_id', job.id)

    if (pageType) {
      countQuery = countQuery.eq('page_type', pageType)
    }
    if (hasGeoBlock !== null) {
      countQuery = countQuery.eq('has_geo_block', hasGeoBlock)
    }
    if (topics.length > 0) {
      countQuery = countQuery.overlaps('topics', topics)
    }

    const { count: total, error: countError } = await countQuery

    if (countError) {
      throw new Error(`Failed to count pages: ${countError.message}`)
    }

    // 6. Build data query
    let dataQuery = supabaseAdmin
      .from('site_audit_pages')
      .select('*')
      .eq('job_id', job.id)

    if (pageType) {
      dataQuery = dataQuery.eq('page_type', pageType)
    }
    if (hasGeoBlock !== null) {
      dataQuery = dataQuery.eq('has_geo_block', hasGeoBlock)
    }
    if (topics.length > 0) {
      dataQuery = dataQuery.overlaps('topics', topics)
    }

    dataQuery = dataQuery.order('created_at', { ascending: false }).range(offset, offset + limit - 1)

    const { data: pages, error: pagesError } = await dataQuery

    if (pagesError) {
      throw new Error(`Failed to fetch pages: ${pagesError.message}`)
    }

    // 7. Calculate hasMore
    const hasMore = (pages?.length ?? 0) === limit && (total ?? 0) > offset + limit

    // 8. Return response
    return NextResponse.json<PagesResponse>(
      {
        pages: (pages || []) as SiteAuditPage[],
        total: total || 0,
        hasMore,
      },
      { status: 200 }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[site-audit/pages] Unexpected error:', message)
    return NextResponse.json<ApiErrorResponse>(
      { error: message },
      { status: 500 }
    )
  }
}
