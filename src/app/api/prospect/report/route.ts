/**
 * GET /api/prospect/report
 *
 * Returns the latest public_scan_jobs row for the authenticated prospect.
 * Auth is validated via Supabase session cookie (set by magic link flow).
 *
 * Returns:
 *   200  { job_id, status, progress_log, domain, result, error }
 *   401  if not authenticated
 *   404  if no scan found for this email
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'

interface JobRow {
  id: string
  status: string
  progress_log: unknown[]
  result: unknown
  error: string | null
  domain: string
  created_at: string
  completed_at: string | null
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabaseAdmin
    .from('public_scan_jobs')
    .select('id, status, progress_log, result, error, domain, created_at, completed_at')
    .eq('email', user.email.toLowerCase())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<JobRow>()

  if (error) {
    console.error('[prospect/report] db error', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: 'No report found for your account.' }, { status: 404 })
  }

  return NextResponse.json({
    job_id: data.id,
    status: data.status,
    progress_log: data.progress_log ?? [],
    domain: data.domain,
    error: data.error,
    created_at: data.created_at,
    completed_at: data.completed_at,
    result: data.status === 'completed' ? data.result : null,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
