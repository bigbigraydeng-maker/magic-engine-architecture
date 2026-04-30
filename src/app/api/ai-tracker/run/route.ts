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
