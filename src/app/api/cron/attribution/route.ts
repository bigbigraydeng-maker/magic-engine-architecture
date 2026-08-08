import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  runAttributionJob,
  DEFAULT_WINDOW_DAYS,
  type AttributionJobResult,
} from '@/lib/flywheel/attribution/job'
import { runGscAttributionForClient } from '@/lib/flywheel/attribution/gsc-bridge'
import {
  dualWindowEnabled,
  resolveEffectiveWindow,
} from '@/lib/flywheel/attribution/dual-window-gate'
import { startCronRun } from '@/lib/cron/run-logger'

/**
 * POST /api/cron/attribution
 *
 * Runs the flywheel attribution job in two passes:
 *
 *   Pass 1 (original) — flywheel_metrics-based attribution:
 *     For every flywheel_action with an expected_metric, computes baseline /
 *     after / verdict and upserts into flywheel_outcomes.
 *
 *   Pass 2 (P17.A.4) — GSC-based attribution:
 *     For every client with a connected GSC connector, runs GSC attribution
 *     for all SEO flywheel actions (clicks / impressions / avg_position).
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}
 * Schedule: every 6 hours (Render Cron)
 *
 * Query params (optional):
 *   window_days — override the default 14-day attribution window (pass 1)
 *   client_id   — restrict both passes to a single client
 *
 * Reference: ROADMAP.md P12.A.9 (pass 1), P17.A.4 (pass 2)
 */

// Attribution job may process many clients; allow up to 5 min.
export const maxDuration = 300

export interface AttributionCronResponse {
  timestamp: string
  processed: number
  written: number
  skipped: number
  /** Actions pass 1 handed to another evaluator because it does not own the metric. */
  deferred?: number
  /** Clients pass 2 must visit because pass 1 did not fully handle them. */
  pass2ClientIds?: string[]
  /** Pass-1 actions whose attribution threw (distinct from having no data yet). */
  failed?: number
  /** Actions no evaluator can attribute (metric owner cannot load their flywheel). */
  unattributable?: number
  /** A bounded sample of those action ids, for diagnosis. */
  unattributableSamples?: string[]
  /** Pass-1 reconciliation failures (claim / retire). Counted into cron `failed`. */
  reconcileErrors?: number
  /** A bounded sample of those messages, for diagnosis. */
  reconcileErrorSamples?: string[]
  /** The window pass 1 actually ran at. */
  window_days?: number
  /** Present when a caller-supplied window was declined by the dual-window gate. */
  window_override_refused?: { requested: number; used: number; reason: string }
  gsc?: {
    clients_processed: number
    actions_found: number
    outcomes_written: number
    skipped: number
    cleanup_errors: number
    /** Pre-write reconciliation failures — see GscAttributionResult. */
    reconcile_errors: number
    errors: string[]
  }
}

export interface ApiErrorResponse {
  error: string
}

export async function POST(
  req: NextRequest
): Promise<NextResponse<AttributionCronResponse | ApiErrorResponse>> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json<ApiErrorResponse>(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 }
    )
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json<ApiErrorResponse>(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  const { searchParams } = new URL(req.url)
  const windowDaysParam = searchParams.get('window_days')
  const clientId = searchParams.get('client_id') ?? undefined

  const requestedWindow =
    windowDaysParam !== null ? parseInt(windowDaysParam, 10) : undefined

  // Pass 1 accepts a window too, and on main a re-run at a different window
  // REPLACED the previous rows. The natural key now appends instead, so this
  // endpoint is a third way to create a second window — gated with the same
  // switch, and the refusal is reported rather than silently applied.
  const pass1 = resolveEffectiveWindow(requestedWindow, DEFAULT_WINDOW_DAYS)
  const windowDays = pass1.windowDays

  const cronRun = await startCronRun('attribution-cron')

  // ── Pass 1: flywheel_metrics-based attribution (existing) ──────────────────
  let pass1Result: AttributionJobResult = {
    processed: 0,
    written: 0,
    skipped: 0,
    failed: 0,
    deferred: 0,
    pass2ClientIds: [],
    unattributable: 0,
    unattributableSamples: [],
    reconcileErrors: 0,
    reconcileErrorSamples: [],
  }
  try {
    pass1Result = await runAttributionJob({ windowDays, clientId })
    console.log(
      `[attribution/cron] pass1 processed=${pass1Result.processed} written=${pass1Result.written} skipped=${pass1Result.skipped} deferred=${pass1Result.deferred} unattributable=${pass1Result.unattributable}`
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[attribution/cron] Pass 1 error:', message)
    await cronRun.finish({ failed: 1, error: message })
    return NextResponse.json<ApiErrorResponse>({ error: message }, { status: 500 })
  }

  // ── Pass 2: GSC snapshot-based attribution (P17.A.4) ──────────────────────
  const gscResult = {
    clients_processed: 0,
    actions_found:     0,
    outcomes_written:  0,
    skipped:           0,
    cleanup_errors:    0,
    reconcile_errors:  0,
    errors:            [] as string[],
  }

  try {
    // A deferral is a promise: pass 1 declined those actions because their
    // answer is the GSC evaluator's to produce, so pass 2 must visit every
    // client pass 1 deferred for — even one whose GSC connector is currently
    // disconnected (the bridge reads historical gsc_performance_snapshots, not
    // the connector; with no usable snapshots it skips harmlessly). The
    // connector list is an optimisation for who ELSE to visit, and its
    // transient failure must neither hide the deferred clients nor pass
    // silently. (Codex P2, second round, on PR #862.)
    let connectedIds: string[] = []
    try {
      connectedIds = await loadGscClientIds(clientId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[attribution/cron] loadGscClientIds error:', message)
      gscResult.errors.push(`load GSC clients: ${message}`)
    }

    const clientIds = Array.from(new Set([...connectedIds, ...pass1Result.pass2ClientIds]))

    // Pass 1 defers actions whose expected_metric the GSC evaluator owns, so
    // its effective window must ride along: the deferred actions' answer at
    // THAT window is now the bridge's to produce. The bridge keeps its own
    // 28-day cadence (first arg left to its default) and computes the deferred
    // window on top, deduplicating when the two coincide. See Issue #859.
    //
    // Sanitised, not just defaulted: parseInt on a malformed ?window_days=
    // yields NaN, which `??` does not catch, and a NaN (or negative) window
    // must not be forwarded — it would defeat the bridge's dedupe guard
    // (NaN === anything is false) and error every deferred action. Pass 1's
    // own handling of the malformed value is unchanged from main.
    // Gated OFF in production. The handoff itself is correct and tested, but
    // the memory-side consumers of flywheel_outcomes still count rows, so
    // enabling it would double the evidence behind every deferred action and
    // move client-visible benchmarks. See dual-window-gate.ts.
    const dualWindow = dualWindowEnabled()
    const pass1Window = windowDays

    for (const cid of clientIds) {
      const r = await runGscAttributionForClient(
        cid,
        undefined,
        dualWindow ? { deferredWindowDays: pass1Window } : {},
      )
      gscResult.clients_processed++
      gscResult.actions_found    += r.actions_found
      gscResult.outcomes_written += r.outcomes_written
      gscResult.skipped           += r.skipped
      gscResult.cleanup_errors    += r.cleanup_errors
      gscResult.reconcile_errors  += r.reconcile_errors
      if (r.errors.length) gscResult.errors.push(...r.errors)
    }

    console.log(
      `[attribution/cron] pass2(gsc) clients=${gscResult.clients_processed} outcomes=${gscResult.outcomes_written} skipped=${gscResult.skipped} deferred_window=${dualWindow ? pass1Window : 'off'}`
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error in GSC attribution pass'
    console.error('[attribution/cron] Pass 2 error:', message)
    gscResult.errors.push(message)
  }

  // All three counters are in the same unit — ACTIONS — so `completed` can be
  // read against `processed`. `completed` used to ignore pass 2 entirely (a run
  // whose only writes came from the GSC evaluator reported zero completed), and
  // counting its outcome ROWS instead would make completed exceed processed
  // several times over, since one action yields three metric rows per window.
  //
  // `failed` counts what actually went wrong this run: pass-1 actions that
  // threw, pass-1 reconciliation failures, plus pass-2 errors (including
  // post-write cleanup failures, which do not reduce `completed`).
  //
  // Reconciliation failures are counted even though the action itself may have
  // attributed perfectly. That is the point: nothing else would ever show them.
  // `written` goes up, `failed` stays 0, the digest reports a healthy run — and
  // meanwhile the unsigned row keeps the contract migration blocked and the
  // duplicated window keeps being counted twice downstream. Pass 2's equivalents
  // were already inside `gscResult.errors`; this is pass 1 catching up.
  // (Codex P1, round 18 on PR #862.)
  //
  // `unattributable` is deliberately NOT counted here
  // — it is a standing property of stored rows, recomputed identically every
  // run, so folding it in would pin the daily digest's alarm on forever with no
  // remediation path. It travels in the response and the run summary instead.
  // See Issue #859.
  const gscAttributed = Math.max(0, gscResult.actions_found - gscResult.skipped)

  await cronRun.finish({
    processed: pass1Result.processed + gscResult.actions_found,
    completed: pass1Result.written + gscAttributed,
    failed: pass1Result.failed + pass1Result.reconcileErrors + gscResult.errors.length,
    summary: { pass1: pass1Result, gsc: gscResult },
  })
  return NextResponse.json<AttributionCronResponse>(
    {
      timestamp: new Date().toISOString(),
      ...pass1Result,
      window_days: windowDays,
      ...(pass1.overrideRefused
        ? {
            window_override_refused: {
              requested: pass1.requested!,
              used: pass1.windowDays,
              reason:
                'Custom attribution windows are disabled while ' +
                'ATTRIBUTION_DUAL_WINDOW_ENABLED is off — a second window would ' +
                'double the evidence behind each action for consumers that still ' +
                'count outcome rows. See Issue #859.',
            },
          }
        : {}),
      gsc: gscResult,
    },
    { status: 200 }
  )
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function loadGscClientIds(singleClientId?: string): Promise<string[]> {
  if (singleClientId) return [singleClientId]

  const { data, error } = await supabaseAdmin
    .from('client_connectors')
    .select('client_id')
    .eq('anchor', 'gsc')
    .eq('status', 'connected')

  if (error) {
    // Throw, don't return [] — an empty list here used to make a transient
    // connectors failure look like a successful "no GSC clients" run, with the
    // only trace in console. The caller records it into gscResult.errors (so
    // the cron summary counts it) and still processes the deferred clients.
    throw new Error(`client_connectors query failed: ${error.message}`)
  }

  return (data ?? []).map((r: { client_id: string }) => r.client_id)
}
