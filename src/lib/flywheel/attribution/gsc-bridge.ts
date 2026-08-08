/**
 * GSC Attribution Bridge — P17.A.4
 *
 * Computes flywheel attribution for SEO actions using Google Search Console
 * snapshot data as the signal source (instead of the generic flywheel_metrics).
 *
 * Algorithm per SEO action:
 *   baseline = most recent gsc_performance_snapshots where period_end <= executed_at
 *   after    = most recent gsc_performance_snapshots where period_end >= executed_at + window_days
 *
 * Writes three flywheel_outcomes rows per action:
 *   seo.gsc.clicks      → after.total_clicks - baseline.total_clicks
 *   seo.gsc.impressions → after.total_impressions - baseline.total_impressions
 *   seo.gsc.avg_position → baseline.avg_position - after.avg_position
 *                          (inverted: lower position number = better, so improvement = positive delta)
 *
 * Reference: ROADMAP.md P17.A.4
 */

import { supabaseAdmin } from '@/lib/supabase'
import { SEO_METRIC_KEY } from '@/lib/flywheel/vocabulary'
import { computeVerdict } from './job'
import {
  GSC_EVALUATOR_METRIC_KEYS,
  OUTCOME_CONFLICT_TARGET,
  OUTCOME_EVALUATOR,
  assertEvaluatorOwnsAll,
  ownsMetric,
  resolveStaleEvaluatorKeys,
} from './outcome-identity'
import {
  findGscPage,
  resolveGscAttributionScope,
  type GscPagePerformance,
} from './gsc-page-scope'

// ─── Types ────────────────────────────────────────────────────────────────────

interface GscSnapshotRow {
  period_end:        string
  total_clicks:      number
  total_impressions: number
  avg_position:      number
  top_pages:         GscPagePerformance[] | null
}

interface SeoActionRow {
  id:              string
  client_id:       string
  executed_at:     string
  action_type:     string
  expected_metric: string | null
  payload:         Record<string, unknown> | null
}

export interface GscAttributionResult {
  client_id:        string
  actions_found:    number
  outcomes_written: number
  skipped:          number
  errors:           string[]
}

export interface GscAttributionOptions {
  /**
   * The window pass 1 (attribution/job.ts) ran at. Pass 1 defers actions whose
   * expected_metric this evaluator owns, so the answer at ITS window becomes
   * this evaluator's to produce — otherwise deferral silently changes which
   * question gets answered (Codex P2 on PR #862: a 14-day ask handed off to a
   * 28-day-only writer means the 14-day outcome never exists).
   *
   * When set and different from `windowDays`, deferred actions are additionally
   * computed at this window. Equal windows are computed once — one computation
   * answers both.
   */
  deferredWindowDays?: number
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** This evaluator's own cadence window for GSC snapshots. */
const GSC_DEFAULT_WINDOW_DAYS = 28

/**
 * Run GSC attribution for all SEO actions for a given client.
 *
 * @param clientId   Target client
 * @param windowDays Days after action to look for the "after" snapshot (default 28)
 * @param opts       See {@link GscAttributionOptions}
 */
export async function runGscAttributionForClient(
  clientId: string,
  windowDays: number = GSC_DEFAULT_WINDOW_DAYS,
  opts: GscAttributionOptions = {},
): Promise<GscAttributionResult> {
  const result: GscAttributionResult = {
    client_id:        clientId,
    actions_found:    0,
    outcomes_written: 0,
    skipped:          0,
    errors:           [],
  }

  // Load all SEO flywheel actions for this client
  const { data: actions, error: actionsErr } = await supabaseAdmin
    .from('flywheel_actions')
    .select('id, client_id, executed_at, action_type, expected_metric, payload')
    .eq('client_id', clientId)
    .eq('flywheel', 'seo')
    .not('expected_metric', 'is', null)
    .order('executed_at', { ascending: false })

  if (actionsErr) {
    result.errors.push(`Failed to load SEO actions: ${actionsErr.message}`)
    return result
  }

  if (!actions?.length) return result

  result.actions_found = actions.length

  for (const action of actions as SeoActionRow[]) {
    // Accumulated OUTSIDE the try so a failure partway through the action does
    // not un-count rows that are already in the database: the cadence-window
    // upsert can succeed and the handoff-window one then fail, and the cron
    // summary must still report the rows that landed.
    let written = 0
    try {
      written = await attributeAction(action, windowDays)

      const handoffWindow = resolveHandoffWindow(action, windowDays, opts.deferredWindowDays)
      if (handoffWindow !== null) {
        written += await attributeAction(action, handoffWindow)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push(`action ${action.id}: ${msg}`)
    }

    if (written > 0) result.outcomes_written += written
    else result.skipped++
  }

  return result
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Which extra window, if any, this action must also be computed at because
 * pass 1 deferred it to us. Returns null when there is nothing to add:
 * no deferred window given, the windows coincide (one computation answers
 * both), or the action was never deferred in the first place — pass 1 only
 * defers metrics this evaluator owns, so an action whose expected_metric
 * belongs to pass 1 already has its answer at the pass-1 window.
 */
function resolveHandoffWindow(
  action: SeoActionRow,
  windowDays: number,
  deferredWindowDays: number | undefined,
): number | null {
  if (deferredWindowDays === undefined) return null
  // Fail-safe against a garbage window reaching this far (the cron route
  // sanitises, but this evaluator guards its own writes): NaN in particular
  // would slip the equality dedupe below — NaN === anything is false — and
  // turn every deferred action into an Invalid Date error.
  if (!Number.isInteger(deferredWindowDays) || deferredWindowDays <= 0) return null
  if (deferredWindowDays === windowDays) return null
  if (!action.expected_metric) return null
  if (!ownsMetric(OUTCOME_EVALUATOR.GSC_SNAPSHOTS, action.expected_metric)) return null
  return deferredWindowDays
}

async function attributeAction(
  action: SeoActionRow,
  windowDays: number,
): Promise<number> {
  const scope = resolveGscAttributionScope(action)
  if (scope.kind === 'skip') return 0

  const executedAt  = action.executed_at
  const windowEnd   = addDays(executedAt, windowDays)

  const [baseline, after] = await Promise.all([
    fetchGscSnapshot(action.client_id, 'before', executedAt),
    fetchGscSnapshot(action.client_id, 'after',  windowEnd),
  ])

  // Need both snapshots to compute attribution
  if (!baseline || !after) return 0

  const rows =
    scope.kind === 'page'
      ? buildPageOutcomeRows(action, baseline, after, scope.pageUrl, windowDays)
      : buildOutcomeRows(action, baseline, after, windowDays)

  if (rows.length === 0) return 0

  // Arbitration, from the owning side: this evaluator may only write metrics it
  // is authoritative for. See Issue #859.
  assertEvaluatorOwnsAll(
    OUTCOME_EVALUATOR.GSC_SNAPSHOTS,
    rows.map(row => row.metric_key as string),
  )

  // Write current truth first. This used to be DELETE-then-INSERT, which meant a
  // failed insert left the action with no outcomes at all until the next
  // successful run. Upserting on the natural key also keeps
  // flywheel_outcomes.id stable across re-runs. See Issue #859.
  const { error } = await supabaseAdmin
    .from('flywheel_outcomes')
    .upsert(rows, { onConflict: OUTCOME_CONFLICT_TARGET })
  if (error) throw new Error(`upsert outcomes: ${error.message}`)

  // Then retire the keys this evaluator owns but no longer produces — e.g. the
  // domain-scope rows left behind once an action becomes page-scoped. Scoped to
  // our own evaluator_key and window so it can never remove the
  // flywheel_metrics evaluator's rows, or our own answer for another window.
  const staleKeys = resolveStaleEvaluatorKeys(
    GSC_EVALUATOR_METRIC_KEYS,
    rows.map(row => row.metric_key as string),
  )

  if (staleKeys.length > 0) {
    const { error: retireError } = await supabaseAdmin
      .from('flywheel_outcomes')
      .delete()
      .eq('action_id', action.id)
      .eq('evaluator_key', OUTCOME_EVALUATOR.GSC_SNAPSHOTS)
      .eq('window_days', windowDays)
      .in('metric_key', staleKeys)
    if (retireError) throw new Error(`retire stale outcomes: ${retireError.message}`)
  }

  return rows.length
}

async function fetchGscSnapshot(
  clientId: string,
  direction: 'before' | 'after',
  dateStr: string,
): Promise<GscSnapshotRow | null> {
  let query = supabaseAdmin
    .from('gsc_performance_snapshots')
    .select('period_end, total_clicks, total_impressions, avg_position, top_pages')
    .eq('client_id', clientId)

  if (direction === 'before') {
    // Most recent snapshot whose period_end is before or on the action date
    query = query.lte('period_end', dateStr).order('period_end', { ascending: false })
  } else {
    // Most recent snapshot whose period_end is at least window_days after the action
    query = query.gte('period_end', dateStr).order('period_end', { ascending: true })
  }

  const { data, error } = await query.limit(1).maybeSingle()

  if (error) {
    console.warn(`[gsc-bridge] fetchGscSnapshot(${direction}) error:`, error.message)
    return null
  }

  return data as GscSnapshotRow | null
}

function buildOutcomeRows(
  action: SeoActionRow,
  baseline: GscSnapshotRow,
  after: GscSnapshotRow,
  windowDays: number,
): Array<Record<string, unknown>> {
  const now = new Date().toISOString()

  const dimensions: Array<{
    metricKey: string
    baselineVal: number
    afterVal: number
    expectedDelta: number | null
  }> = [
    {
      metricKey:     SEO_METRIC_KEY.GSC_CLICKS,
      baselineVal:   baseline.total_clicks,
      afterVal:      after.total_clicks,
      expectedDelta: 1, // expect clicks to increase
    },
    {
      metricKey:     SEO_METRIC_KEY.GSC_IMPRESSIONS,
      baselineVal:   baseline.total_impressions,
      afterVal:      after.total_impressions,
      expectedDelta: 1, // expect impressions to increase
    },
    {
      // avg_position: lower number = better rank.
      // We flip the delta so positive delta = improvement:
      //   baseline_position=10, after_position=8 → delta = 10-8 = +2 (improvement)
      metricKey:     SEO_METRIC_KEY.GSC_AVG_POSITION,
      baselineVal:   baseline.avg_position,
      afterVal:      after.avg_position,
      expectedDelta: 1, // expect position to improve (numeric delta will be positive when it does)
    },
  ]

  return dimensions.map(dim => {
    // For position: delta = baseline - after (positive = rank improved)
    // For clicks/impressions: delta = after - baseline (positive = growth)
    const delta =
      dim.metricKey === SEO_METRIC_KEY.GSC_AVG_POSITION
        ? round2(dim.baselineVal - dim.afterVal)
        : round2(dim.afterVal - dim.baselineVal)

    const deltaPct =
      dim.baselineVal !== 0 ? round2((delta / Math.abs(dim.baselineVal)) * 100) : null

    const { verdict, confidence } = computeVerdict(delta, deltaPct, dim.expectedDelta)

    return {
      action_id:   action.id,
      client_id:   action.client_id,
      metric_key:  dim.metricKey,
      baseline:    dim.metricKey === SEO_METRIC_KEY.GSC_AVG_POSITION
                     ? dim.baselineVal
                     : dim.baselineVal,
      after_value: dim.afterVal,
      delta,
      delta_pct:   deltaPct,
      confidence,
      verdict,
      window_days: windowDays,
      evaluator_key: OUTCOME_EVALUATOR.GSC_SNAPSHOTS,
      computed_at: now,
    }
  })
}

function buildPageOutcomeRows(
  action: SeoActionRow,
  baseline: GscSnapshotRow,
  after: GscSnapshotRow,
  pageUrl: string,
  windowDays: number,
): Array<Record<string, unknown>> {
  const baselinePage = findGscPage(baseline.top_pages, pageUrl)
  const afterPage = findGscPage(after.top_pages, pageUrl)
  if (!baselinePage || !afterPage) return []

  const now = new Date().toISOString()
  const dimensions = [
    {
      metricKey: SEO_METRIC_KEY.GSC_PAGE_CLICKS,
      baselineVal: baselinePage.clicks,
      afterVal: afterPage.clicks,
      invertDelta: false,
    },
    {
      metricKey: SEO_METRIC_KEY.GSC_PAGE_IMPRESSIONS,
      baselineVal: baselinePage.impressions,
      afterVal: afterPage.impressions,
      invertDelta: false,
    },
    {
      metricKey: SEO_METRIC_KEY.GSC_PAGE_AVG_POSITION,
      baselineVal: baselinePage.position,
      afterVal: afterPage.position,
      invertDelta: true,
    },
  ]

  return dimensions.map((dim) => {
    const delta = round2(
      dim.invertDelta
        ? dim.baselineVal - dim.afterVal
        : dim.afterVal - dim.baselineVal,
    )
    const deltaPct =
      dim.baselineVal !== 0 ? round2((delta / Math.abs(dim.baselineVal)) * 100) : null
    const { verdict, confidence } = computeVerdict(delta, deltaPct, 1)

    return {
      action_id: action.id,
      client_id: action.client_id,
      metric_key: dim.metricKey,
      baseline: dim.baselineVal,
      after_value: dim.afterVal,
      delta,
      delta_pct: deltaPct,
      confidence,
      verdict,
      window_days: windowDays,
      evaluator_key: OUTCOME_EVALUATOR.GSC_SNAPSHOTS,
      computed_at: now,
    }
  })
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
