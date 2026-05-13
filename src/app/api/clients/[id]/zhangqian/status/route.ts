/**
 * GET /api/clients/[id]/zhangqian/status?job_id=<uuid>
 *
 * Poll the status of a Zhangqian discovery job. Returns current status +
 * progress_note for the UI to render a live progress bar.
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.10.S0.9
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import { getJob } from '@/lib/zhangqian/persistor'

export async function GET(
  req: NextRequest,
  { params: _params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const url = new URL(req.url)
    const jobId = url.searchParams.get('job_id')
    if (!jobId) {
      return NextResponse.json(
        { success: false, error: 'job_id query parameter is required' },
        { status: 400 },
      )
    }

    const job = await getJob(supabaseAdmin, jobId)
    if (!job) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, job })
  } catch (err: unknown) {
    console.error('[zhangqian/status] error', err)
    return NextResponse.json(
      { success: false, error: 'Failed to read job status' },
      { status: 500 },
    )
  }
}
