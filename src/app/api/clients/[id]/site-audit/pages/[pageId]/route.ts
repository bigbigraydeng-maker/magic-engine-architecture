/**
 * GET /api/clients/[id]/site-audit/pages/[pageId]
 *
 * Returns full details of a single crawled page including markdown_content and geo_block_info.
 * Validates that the page belongs to a job owned by the specified client (multi-tenant isolation).
 *
 * Response:
 * {
 *   page: SiteAuditPage  // Full page record with markdown_content and geo_block_info
 * }
 *
 * Reference: ROADMAP.md P8.0.5.5
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type { SiteAuditPage } from '@/lib/site-audit/job-runner'

// Allow up to 60 seconds
export const maxDuration = 60

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PageDetailResponse {
  page: SiteAuditPage
}

export interface ApiErrorResponse {
  error: string
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; pageId: string } }
): Promise<NextResponse<PageDetailResponse | ApiErrorResponse>> {
  const clientId = params.id
  const pageId = params.pageId

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

    // 2. Fetch the page by ID
    const { data: page, error: pageError } = await supabaseAdmin
      .from('site_audit_pages')
      .select('*')
      .eq('id', pageId)
      .single()

    if (pageError) {
      // PGRST116 = no rows found, treat as 404
      if (pageError.code === 'PGRST116') {
        return NextResponse.json<ApiErrorResponse>(
          { error: 'Page not found' },
          { status: 404 }
        )
      }
      // Other errors are database errors
      throw new Error(`Failed to fetch page: ${pageError.message}`)
    }

    if (!page) {
      return NextResponse.json<ApiErrorResponse>(
        { error: 'Page not found' },
        { status: 404 }
      )
    }

    // 3. Verify the page belongs to this client
    //    by checking that the job_id matches a job owned by this client
    const { data: job, error: jobError } = await supabaseAdmin
      .from('site_audit_jobs')
      .select('id, client_id')
      .eq('id', page.job_id)
      .single()

    if (jobError) {
      // PGRST116 = no rows found, treat as 404
      if (jobError.code === 'PGRST116') {
        return NextResponse.json<ApiErrorResponse>(
          { error: 'Job not found' },
          { status: 404 }
        )
      }
      // Other errors are database errors
      throw new Error(`Failed to fetch job: ${jobError.message}`)
    }

    if (!job) {
      return NextResponse.json<ApiErrorResponse>(
        { error: 'Job not found' },
        { status: 404 }
      )
    }

    if (job.client_id !== clientId) {
      return NextResponse.json<ApiErrorResponse>(
        { error: 'Access denied' },
        { status: 403 }
      )
    }

    // 4. Return the page details
    return NextResponse.json<PageDetailResponse>(
      {
        page: page as SiteAuditPage,
      },
      { status: 200 }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[site-audit/pages/[pageId]] Unexpected error:', message)
    return NextResponse.json<ApiErrorResponse>(
      { error: message },
      { status: 500 }
    )
  }
}
