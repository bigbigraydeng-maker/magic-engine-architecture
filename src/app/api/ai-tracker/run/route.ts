import { NextRequest, NextResponse } from 'next/server'
import { runTracker } from '@/lib/ai-tracker/orchestrator'
import type { AiEngine } from '@/types/magic-engine'

/**
 * POST /api/ai-tracker/run
 *
 * Manually trigger a Tracker pass for a client. Long-running endpoint
 * (typical 1-5 minutes for 18 questions × 2 engines).
 *
 * Reference: ROADMAP.md P7.1.10, ARCHITECTURE.md §12.3
 *
 * Body:
 * {
 *   client_id: string         // required
 *   query_ids?: string[]      // optional subset; defaults to all enabled
 *   engines?: ('openai'|'anthropic')[]  // optional; defaults to both
 * }
 *
 * Response on success: full RunTrackerResult
 */
export const maxDuration = 300 // 5 minutes — Render long-poll budget

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { success: false, error: 'Server misconfiguration' },
      { status: 500 }
    )
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    )
  }

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

    if (body.engines) {
      const validEngines = ['openai', 'anthropic']
      if (!body.engines.every((e) => validEngines.includes(e))) {
        return NextResponse.json(
          { success: false, error: 'Invalid engine specified' },
          { status: 400 }
        )
      }
    }

    const result = await runTracker({
      client_id: body.client_id,
      query_ids: body.query_ids,
      engines: body.engines,
    })

    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}
