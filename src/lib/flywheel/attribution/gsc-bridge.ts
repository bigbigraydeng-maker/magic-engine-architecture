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
import { fetchAll } from '@/lib/supabase-paginate'
import { SEO_METRIC_KEY } from '@/lib/flywheel/vocabulary'
import { computeVerdict } from './job'
import {
  GSC_DOMAIN_METRIC_KEYS,
  GSC_EVALUATOR_METRIC_KEYS,
  OUTCOME_CONFLICT_TARGET,
  OUTCOME_EVALUATOR,
  assertEvaluatorOwnsAll,
  evaluatorLoadableFlywheels,
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
  /**
   * Stale-row reconciliation failures that happened AFTER their outcomes were
   * already written. Counted separately because they do not undo the write:
   * `outcomes_written` still reports every row that landed. Folding these into
   * "nothing was written" is what made a successful run look like a total
   * failure (and return 502). (Codex P2 round 3 on PR #862.)
   */
  cleanup_errors:   number
}

/** One action's attribution: what landed, and whether tidying up afterwards failed. */
interface AttributeActionResult {
  /** Rows successfully upserted. Never reduced by a later cleanup failure. */
  written: number
  /** Message if retiring superseded rows failed, else null. */
  cleanupError: string | null
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
 * The flywheels this evaluator's action query filters on.
 *
 * `null` in the shared declaration means "any flywheel" — but a PostgREST
 * `.in('flywheel', [])` means "no flywheel", the exact inversion. Widening this
 * evaluator to `null` without also removing the filter would silently select
 * nothing and report a clean, empty pass while routing every GSC-owned action
 * to it. Throwing makes that mistake impossible to ship quietly.
 */
function loadableFlywheelsOrThrow(): readonly string[] {
  const scope = evaluatorLoadableFlywheels(OUTCOME_EVALUATOR.GSC_SNAPSHOTS)
  if (scope === null) {
    throw new Error(
      'gsc-bridge: this evaluator is declared loadable for every flywheel, but its ' +
        'action query filters on a list. Remove the .in() filter instead of passing ' +
        'an empty array, which would match nothing.',
    )
  }
  return scope
}

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
    cleanup_errors:   0,
  }

  // Load this evaluator's actions for the client. The flywheel filter comes
  // from the shared declaration rather than a literal, so pass 1's decision to
  // defer to us and our decision to load cannot drift apart — an action
  // deferred here but excluded by this query would never be attributed at all.
  // Paginated for the same reason pass 1 and the audit are: PostgREST caps a
  // response at 1000 rows silently, and newest-first ordering means the rows
  // dropped are the OLDEST. Pass 1 now defers every GSC-owned action it finds,
  // but `pass2ClientIds` carries only client ids — so a truncation here loses
  // exactly the deferred actions pass 1 promised we would answer, and nothing
  // reports it.
  let actions: SeoActionRow[]
  try {
    actions = await fetchAll<SeoActionRow>((from, to) =>
      supabaseAdmin
        .from('flywheel_actions')
        .select('id, client_id, executed_at, action_type, expected_metric, payload')
        .eq('client_id', clientId)
        .in('flywheel', loadableFlywheelsOrThrow())
        .not('expected_metric', 'is', null)
        // `id` as a unique tiebreak — `executed_at` is not unique, and an
        // unstable sort repeats or drops rows at page boundaries.
        .order('executed_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    result.errors.push(`Failed to load SEO actions: ${message}`)
    return result
  }

  if (!actions.length) return result

  result.actions_found = actions.length

  for (const action of actions) {
    // Accumulated OUTSIDE the try so a failure partway through the action does
    // not un-count rows that are already in the database: the cadence-window
    // upsert can succeed and the handoff-window one then fail, and the cron
    // summary must still report the rows that landed.
    let written = 0
    try {
      const cadence = await attributeAction(action, windowDays)
      written = cadence.written
      if (cadence.cleanupError) {
        result.cleanup_errors++
        result.errors.push(`action ${action.id}: ${cadence.cleanupError}`)
      }

      const handoffWindow = resolveHandoffWindow(action, windowDays, opts.deferredWindowDays)
      if (handoffWindow !== null) {
        const handoff = await attributeAction(action, handoffWindow)
        written += handoff.written
        if (handoff.cleanupError) {
          result.cleanup_errors++
          result.errors.push(`action ${action.id}: ${handoff.cleanupError}`)
        }
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
): Promise<AttributeActionResult> {
  const nothing: AttributeActionResult = { written: 0, cleanupError: null }

  const scope = resolveGscAttributionScope(action)
  if (scope.kind === 'skip') return nothing

  const executedAt  = action.executed_at
  const windowEnd   = addDays(executedAt, windowDays)

  const [baseline, after] = await Promise.all([
    fetchGscSnapshot(action.client_id, 'before', executedAt),
    fetchGscSnapshot(action.client_id, 'after',  windowEnd),
  ])

  // Need both snapshots to compute attribution
  if (!baseline || !after) return nothing

  const rows =
    scope.kind === 'page'
      ? buildPageOutcomeRows(action, baseline, after, scope.pageUrl, windowDays)
      : buildOutcomeRows(action, baseline, after, windowDays)

  if (rows.length === 0) {
    // Normally producing nothing is not a refutation of the previous answer, so
    // nothing is retired. Page scope is the exception: the action being about
    // one specific page makes its domain-level outcomes wrong *by scope*, not
    // by this run's data. Whether the page happens to appear in this snapshot's
    // top_pages is a separate question, and letting it decide would leave rows
    // the old ungated bridge wrote visible on the execution board — and feeding
    // memory and benchmarks — indefinitely.
    if (scope.kind === 'page') {
      const claimError = await claimOwnUnclaimedRows(action)
      return {
        written: 0,
        cleanupError:
          claimError ?? (await retireOwnKeys(action, GSC_DOMAIN_METRIC_KEYS)),
      }
    }
    return nothing
  }

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

  // Adopt any row an older deployment left unsigned, BEFORE retiring — a retire
  // filtered on our evaluator_key cannot see a NULL one.
  const claimError = await claimOwnUnclaimedRows(action)

  // Then retire the keys this evaluator owns but no longer produces — e.g. the
  // domain-scope rows left behind once an action becomes page-scoped.
  const staleKeys = resolveStaleEvaluatorKeys(
    GSC_EVALUATOR_METRIC_KEYS,
    rows.map(row => row.metric_key as string),
  )

  return {
    written: rows.length,
    cleanupError: claimError ?? (await retireOwnKeys(action, staleKeys)),
  }
}

/**
 * Sign the rows this evaluator produced before `evaluator_key` existed.
 *
 * The expand migration backfills `evaluator_key` once, at apply time. But the
 * rollout deliberately leaves the OLD code running against the expanded table
 * until #862 deploys, and that old manual endpoint accepts any window from 1 to
 * 90 — so a 7-day run inside that gap writes a fresh row with a NULL evaluator
 * that the completed backfill will never revisit. Afterwards nothing reclaims
 * it: the gate refuses custom windows, and the cron only ever recomputes its
 * cadence, so the new writer never lands on that natural key. The row would sit
 * unsigned forever and make the contract migration's `NULL count = 0`
 * precondition permanently unsatisfiable. (Codex P2, round 15 on PR #862.)
 *
 * Safe because the metric namespace decides ownership: `seo.gsc.*` has only
 * ever been written by this evaluator, which is the same rule the backfill and
 * the `flywheel_outcomes_evaluator_owns_metric` CHECK encode. Scoped to one
 * action, to NULL rows only, and to keys in our own vocabulary, so it can
 * neither overwrite an existing signature nor claim another writer's work.
 *
 * An UPDATE, not a DELETE: the row is a real measurement, and the whole point
 * of this Work Package is that no writer destroys another's evidence.
 */
async function claimOwnUnclaimedRows(action: SeoActionRow): Promise<string | null> {
  const { error } = await supabaseAdmin
    .from('flywheel_outcomes')
    .update({ evaluator_key: OUTCOME_EVALUATOR.GSC_SNAPSHOTS })
    .eq('action_id', action.id)
    .is('evaluator_key', null)
    .in('metric_key', GSC_EVALUATOR_METRIC_KEYS)

  return error ? `claim unsigned outcomes: ${error.message}` : null
}

/**
 * Delete outcome rows this evaluator owns for keys it no longer stands behind.
 *
 * Scoped to our own `evaluator_key`, so it can never remove the
 * flywheel_metrics evaluator's rows. Deliberately NOT scoped by window — see
 * the note on the delete below.
 *
 * Returns the error rather than throwing: by the time this runs the current
 * rows are already in the database, and throwing would discard that count and
 * report the run as having written nothing. A superseded row left behind is a
 * reconciliation debt for the next run, not a reason to disown a good write.
 */
async function retireOwnKeys(
  action: SeoActionRow,
  metricKeys: readonly string[],
): Promise<string | null> {
  if (metricKeys.length === 0) return null

  // Deliberately NOT filtered by window. These keys are retired because the
  // action's SCOPE rules them out — a page-scoped action's domain numbers are
  // wrong at every window, not just the one being recomputed. The manual
  // endpoint accepts any window from 1 to 90 while the cron only ever revisits
  // its cadence and pass 1's window, so a window-scoped delete would strand
  // rows written at, say, 7 days forever, still feeding the execution board and
  // the benchmarks. Scoped to this action and this evaluator, so it can never
  // touch the flywheel_metrics evaluator's rows.
  const { error } = await supabaseAdmin
    .from('flywheel_outcomes')
    .delete()
    .eq('action_id', action.id)
    .eq('evaluator_key', OUTCOME_EVALUATOR.GSC_SNAPSHOTS)
    .in('metric_key', metricKeys)

  return error ? `retire stale outcomes: ${error.message}` : null
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

  // Throw rather than returning null: "the query failed" and "this client has no
  // snapshot on that side yet" both used to arrive here as null, and the caller
  // reads null as the latter — counting the action as `skipped` with an empty
  // `errors` array, so a transient PostgREST failure logged as a healthy run
  // that simply had nothing to do. That is the shape pass 1 no longer covers
  // for, since it defers these actions instead of attributing them. The caller
  // catches this per action, so one bad query does not abort the client.
  if (error) {
    throw new Error(`gsc snapshot query (${direction}): ${error.message}`)
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
