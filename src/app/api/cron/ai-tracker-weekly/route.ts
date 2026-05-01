import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { runTracker } from '@/lib/ai-tracker/orchestrator'

/**
 * GET /api/cron/ai-tracker-weekly
 *
 * Weekly cron — runs the AI Visibility Tracker for every client that has
 * at least one enabled query. Triggered by Render Cron every Monday.
 *
 * Auth: Bearer ${CRON_SECRET}
 *
 * Reference: ROADMAP.md P7.1.11, ARCHITECTURE.md §12.3
 */

// Render long-running cron tier; allow up to 15 min to cover several clients.
export const maxDuration = 900

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 }
    )
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find clients that have at least one enabled query
  const { data: clientsWithQueries, error: queryErr } = await supabaseAdmin
    .from('ai_visibility_queries')
    .select('client_id')
    .eq('enabled', true)

  if (queryErr) {
    return NextResponse.json(
      { error: `Failed to load clients: ${queryErr.message}` },
      { status: 500 }
    )
  }

  const clientIds = Array.from(
    new Set((clientsWithQueries ?? []).map(r => (r as { client_id: string }).client_id))
  )

  if (clientIds.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No clients have enabled queries — nothing to run',
      clients_processed: 0,
    })
  }

  const results: Array<{
    client_id: string
    runs_succeeded: number
    runs_failed: number
    cost_usd: number
    error?: string
  }> = []

  // Process clients sequentially — multiple clients in parallel would
  // multiply provider RPM pressure.
  for (const clientId of clientIds) {
    try {
      const result = await runTracker({ client_id: clientId })
      results.push({
        client_id: clientId,
        runs_succeeded: result.runs_succeeded,
        runs_failed: result.runs_failed,
        cost_usd: result.total_cost_usd,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      results.push({
        client_id: clientId,
        runs_succeeded: 0,
        runs_failed: 0,
        cost_usd: 0,
        error: message,
      })
    }
  }

  const totalCost = results.reduce((s, r) => s + r.cost_usd, 0)

  return NextResponse.json({
    success: true,
    clients_processed: results.length,
    total_cost_usd: totalCost,
    results,
  })
}
