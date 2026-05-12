import { NextRequest, NextResponse } from 'next/server'
import { runTracker } from '@/lib/ai-tracker/orchestrator'
import type { AiEngine } from '@/types/magic-engine'

/**
 * POST /api/ai-tracker/run-dashboard
 *
 * Dashboard-facing wrapper around runTracker. Called by the "Run Now" button
 * in /dashboard/ai-visibility/[clientId]. Does not require CRON_SECRET.
 *
 * Auth note: currently open while P8.3.2 session auth is pending.
 * TODO(P8.3.2): add session/cookie check once dashboard auth lands.
 *
 * Body:  { client_id: string }
 * Response: same shape as /api/ai-tracker/run on success
 */
export const maxDuration = 300

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      client_id?: string
      query_ids?: string[]
      engines?: AiEngine[]
    }

    if (!body.client_id) {
      return NextResponse.json(
        { success: false, error: 'client_id is required' },
        { status: 400 }
      )
    }

    if (!/^[a-f0-9\-]{36}$/.test(body.client_id)) {
      return NextResponse.json(
        { success: false, error: 'Invalid client_id format' },
        { status: 400 }
      )
    }

    const result = await runTracker({
      client_id: body.client_id,
      query_ids: body.query_ids,
      engines: body.engines,
    })

    return NextResponse.json({ success: true, ...result })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}
