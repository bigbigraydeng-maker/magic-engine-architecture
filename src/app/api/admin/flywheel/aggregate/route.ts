/**
 * GET /api/admin/flywheel/aggregate
 *
 * Returns verdict statistics grouped by action_type across all clients
 * (or a single client when client_id is specified).
 *
 * Used by:
 *  - Admin Dashboard "飞轮成效" card (P12.C.1)
 *  - P22.B.3 Action attribution analysis
 *
 * Query params:
 *   top        — number of top entries to return, default 5 (max 20)
 *   min        — minimum total outcomes required per entry, default 2
 *   client_id  — optional; when provided, scopes results to that client only
 *   flywheel   — optional; filter by flywheel ("seo" | "geo" | "ads" | "social")
 *
 * Security: Admin-only (guardAdmin).
 * Reference: ROADMAP.md Phase 12.C.1 + Phase 22.B.3
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { buildAggregateRows, pickTop } from '@/lib/flywheel/aggregate/outcome-aggregate'
import { guardAdmin } from '@/lib/auth/require-admin'
import { keepOneCasePerAction } from '@/lib/flywheel/attribution/outcome-identity'

export const dynamic = 'force-dynamic'

type JoinedAction = {
  action_type: string
  flywheel: string | null
  expected_metric?: string | null
}

type OutcomeRow = {
  action_id: string
  metric_key: string
  window_days: number | null
  verdict: string
  flywheel_actions: JoinedAction | JoinedAction[]
}


function buildQuery(clientId: string | null, flywheel: string | null) {
  let query = supabaseAdmin
    .from('flywheel_outcomes')
    .select(
      'action_id, metric_key, window_days, verdict, ' +
      'flywheel_actions!inner(action_type, flywheel, client_id, expected_metric)',
    )

  // PostgREST: filter on joined table columns via dot notation
  if (clientId) query = (query as typeof query).eq('flywheel_actions.client_id', clientId)
  if (flywheel) query = (query as typeof query).eq('flywheel_actions.flywheel', flywheel)

  return query
}

/**
 * Collapse to one row per ACTION before anything is counted.
 *
 * "How often does this kind of action work" is a question about actions, and an
 * outcome row is not an action: a GSC action yields clicks, impressions and
 * avg_position from one snapshot pair — three readings of one event — and, once
 * ATTRIBUTION_DUAL_WINDOW_ENABLED is on, each of those again at a second
 * window. Counting rows lets a single action clear the `min` sample threshold by
 * itself and pull the success rate with it, which changes which action types get
 * recommended. Same fold the case-library, the confidence readers and the
 * execution board use, so the four cannot disagree about what a sample is.
 * (Codex P2, round 26 on PR #862.)
 */
function collapseToActions(
  data: OutcomeRow[] | null,
): Array<{ action_type: string; verdict: string }> {
  const collapsed = keepOneCasePerAction(
    (data ?? []).map(r => {
      const a = Array.isArray(r.flywheel_actions) ? r.flywheel_actions[0] : r.flywheel_actions
      return {
        action_id: r.action_id,
        metric_key: r.metric_key,
        window_days: r.window_days,
        expected_metric: a?.expected_metric ?? null,
        action_type: a?.action_type ?? 'unknown',
        verdict: r.verdict,
      }
    }),
  )

  return collapsed.map(r => ({ action_type: r.action_type, verdict: r.verdict }))
}

export async function GET(request: Request) {
  const guard = await guardAdmin()
  if (guard) return guard

  const { searchParams } = new URL(request.url)
  const top       = Math.min(Math.max(parseInt(searchParams.get('top')  ?? '5', 10), 1), 20)
  const min       = Math.max(parseInt(searchParams.get('min')  ?? '2', 10), 1)
  const clientId  = searchParams.get('client_id') ?? null
  const flywheel  = searchParams.get('flywheel')  ?? null

  // ── Build query ─────────────────────────────────────────────────────────────

  const { data, error } = await buildQuery(clientId, flywheel)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── Flatten and aggregate ───────────────────────────────────────────────────

  const rows = collapseToActions(data as unknown as OutcomeRow[] | null)

  const aggregate  = buildAggregateRows(rows)
  const topEntries = pickTop(aggregate, top, min)

  return NextResponse.json({
    top: topEntries,
    total_actions: aggregate.length,
    total_outcomes: rows.length,
    filters: { client_id: clientId, flywheel },
  })
}
