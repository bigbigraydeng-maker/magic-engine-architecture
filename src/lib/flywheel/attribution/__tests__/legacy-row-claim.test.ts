/**
 * Rows the deploy window leaves unsigned — Issue #859, Codex P2 round 15.
 *
 * The expand migration backfills `evaluator_key` ONCE, at apply time. The
 * rollout then deliberately keeps the OLD code running against the expanded
 * table until #862 deploys, and that old code accepted any window from 1 to 90.
 * A row written inside that gap therefore gets a NULL evaluator that the
 * finished backfill will never revisit.
 *
 * What makes it permanent rather than transient: after the deploy the gate
 * refuses custom windows and each writer only recomputes its own cadence, so
 * the new writers never land on that natural key — nothing ever signs the row.
 * The contract migration's `NULL count = 0` precondition would then be
 * unsatisfiable forever, and the rollout could not finish.
 *
 * So each writer adopts the rows it can prove are its own: same action, NULL
 * evaluator, metric key inside its own vocabulary. An UPDATE, never a DELETE —
 * the row is a real measurement, and the point of this Work Package is that no
 * writer destroys another's evidence.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FakeOutcomesDb } from './fake-outcomes-db'
import { OUTCOME_EVALUATOR } from '../outcome-identity'
import { DUAL_WINDOW_FLAG } from '../dual-window-gate'

let db: FakeOutcomesDb

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => db.from(table),
  },
}))

const ACTION_ID = 'action-seo-1'
const CLIENT_ID = 'client-1'
const EXECUTED_AT = '2026-06-01T00:00:00.000Z'
const GSC_CLICKS = 'seo.gsc.clicks'
const SOCIAL_METRIC = 'social.followers'

function seedSeoAction(): void {
  db.seed('flywheel_actions', [
    {
      id: ACTION_ID,
      client_id: CLIENT_ID,
      flywheel: 'seo',
      action_type: 'seo.publish_blog',
      expected_metric: GSC_CLICKS,
      expected_delta: 1,
      executed_at: EXECUTED_AT,
      payload: null,
    },
  ])
}

function seedGscSnapshots(): void {
  db.seed('gsc_performance_snapshots', [
    { client_id: CLIENT_ID, period_end: '2026-05-31', total_clicks: 100, total_impressions: 1000, avg_position: 20, top_pages: null },
    { client_id: CLIENT_ID, period_end: '2026-07-15', total_clicks: 150, total_impressions: 1600, avg_position: 12, top_pages: null },
  ])
}

/**
 * A row exactly as the OLD code left it: no `evaluator_key` column value at
 * all. Written at 7 days — a window neither writer will ever recompute once the
 * gate is off, which is what makes it unreachable by the ordinary upsert path.
 */
function seedUnsignedRow(over: Record<string, unknown> = {}): void {
  db.seed('flywheel_outcomes', [
    {
      id: 'legacy-1',
      action_id: ACTION_ID,
      client_id: CLIENT_ID,
      metric_key: GSC_CLICKS,
      window_days: 7,
      baseline: 100,
      after_value: 120,
      delta: 20,
      delta_pct: 20,
      confidence: 0.9,
      verdict: 'confirmed',
      evaluator_key: null,
      computed_at: '2026-06-10T00:00:00.000Z',
      ...over,
    },
  ])
}

async function runBridge(windowDays = 28) {
  const { runGscAttributionForClient } = await import('../gsc-bridge')
  return runGscAttributionForClient(CLIENT_ID, windowDays)
}

async function runJob(windowDays?: number) {
  const { runAttributionJob } = await import('../job')
  return runAttributionJob({ clientId: CLIENT_ID, windowDays })
}

beforeEach(() => {
  db = new FakeOutcomesDb()
  vi.clearAllMocks()
  delete process.env[DUAL_WINDOW_FLAG] // shipped default: dual window OFF
})

// ── The GSC evaluator ────────────────────────────────────────────────────────

describe('the GSC evaluator adopts its own unsigned rows', () => {
  it('signs a 7-day row it can never recompute (dual-window ON)', async () => {
    process.env[DUAL_WINDOW_FLAG] = 'true'
    seedSeoAction()
    seedGscSnapshots()
    seedUnsignedRow()

    await runBridge(28)

    const legacy = db.outcomes().find(r => r.window_days === 7)
    expect(legacy?.evaluator_key).toBe(OUTCOME_EVALUATOR.GSC_SNAPSHOTS)
  })

  it('claims by UPDATE — the measurement itself survives (dual-window ON)', async () => {
    process.env[DUAL_WINDOW_FLAG] = 'true'
    seedSeoAction()
    seedGscSnapshots()
    seedUnsignedRow()

    await runBridge(28)

    const legacy = db.outcomes().find(r => r.window_days === 7)
    // Same row, same id, same numbers. Only the signature was missing.
    expect(legacy?.id).toBe('legacy-1')
    expect(legacy?.delta).toBe(20)
    expect(legacy?.verdict).toBe('confirmed')
  })

  it('signs an immature action\u2019s row even though attribution produces nothing', async () => {
    // No snapshots at all: attributeAction returns early on the missing
    // baseline/after pair. Reconciling only on the success path would leave the
    // row unsigned for as long as the action stays immature — up to a full
    // window — and the rollout's NULL-count gate would sit blocked on it.
    process.env[DUAL_WINDOW_FLAG] = 'true'
    seedSeoAction()
    seedUnsignedRow()

    const result = await runBridge(28)

    expect(result.outcomes_written).toBe(0) // nothing to attribute yet
    expect(db.outcomes().find(r => r.window_days === 7)?.evaluator_key)
      .toBe(OUTCOME_EVALUATOR.GSC_SNAPSHOTS)
  })

  it('leaves the other evaluator\'s unsigned rows alone', async () => {
    process.env[DUAL_WINDOW_FLAG] = 'true'
    // The claim is only safe because the metric namespace decides ownership.
    // A social metric was never written by the GSC evaluator, so signing it
    // would be inventing provenance — and Postgres would reject it anyway.
    seedSeoAction()
    seedGscSnapshots()
    seedUnsignedRow({ id: 'legacy-2', metric_key: SOCIAL_METRIC })

    const result = await runBridge(28)

    const other = db.outcomes().find(r => r.id === 'legacy-2')
    expect(other?.evaluator_key).toBeNull()
    // And the row must be excluded by the QUERY, not by Postgres rejecting the
    // write: an unscoped claim leaves the row untouched too, but only because
    // the ownership CHECK aborted the whole statement — which also loses the
    // rows the claim was supposed to sign. A clean run is the real assertion.
    expect(result.cleanup_errors).toBe(0)
    expect(result.errors).toEqual([])
  })

  it('never re-signs a row another evaluator already signed', async () => {
    process.env[DUAL_WINDOW_FLAG] = 'true'
    seedSeoAction()
    seedGscSnapshots()
    seedUnsignedRow({
      id: 'legacy-3',
      metric_key: SOCIAL_METRIC,
      evaluator_key: OUTCOME_EVALUATOR.FLYWHEEL_METRICS,
    })

    await runBridge(28)

    const other = db.outcomes().find(r => r.id === 'legacy-3')
    expect(other?.evaluator_key).toBe(OUTCOME_EVALUATOR.FLYWHEEL_METRICS)
  })

  it('reports a failed claim instead of counting the run clean', async () => {
    process.env[DUAL_WINDOW_FLAG] = 'true'
    seedSeoAction()
    seedGscSnapshots()
    seedUnsignedRow()
    db.failNext('flywheel_outcomes', 'update', 'deadlock detected')

    const result = await runBridge(28)

    // The rows this run wrote are in the database and still counted...
    expect(result.outcomes_written).toBe(3)
    // ...but the debt is named, not swallowed.
    expect(result.cleanup_errors).toBe(1)
    expect(result.errors.join(' ')).toContain('claim unsigned outcomes')
  })
})

// ── The flywheel_metrics evaluator ───────────────────────────────────────────

describe('the flywheel_metrics evaluator adopts its own unsigned rows', () => {
  function seedSocialAction(): void {
    db.seed('flywheel_actions', [
      {
        id: 'action-social-1',
        client_id: CLIENT_ID,
        flywheel: 'social',
        action_type: 'social.publish',
        expected_metric: SOCIAL_METRIC,
        expected_delta: 1,
        executed_at: EXECUTED_AT,
        payload: null,
      },
    ])
    db.seed('flywheel_metrics', [
      { client_id: CLIENT_ID, metric_key: SOCIAL_METRIC, metric_value: 100, measured_at: '2026-05-30T00:00:00.000Z' },
      { client_id: CLIENT_ID, metric_key: SOCIAL_METRIC, metric_value: 140, measured_at: '2026-06-05T00:00:00.000Z' },
    ])
  }

  it('signs a 21-day row left by the old ungated pass 1 (dual-window ON)', async () => {
    process.env[DUAL_WINDOW_FLAG] = 'true'
    // Reachable on main: the cron accepted ?window_days=. After the deploy the
    // gate refuses it and this job only recomputes DEFAULT_WINDOW_DAYS, so the
    // upsert never lands on window 21 again.
    seedSocialAction()
    db.seed('flywheel_outcomes', [
      {
        id: 'legacy-21',
        action_id: 'action-social-1',
        client_id: CLIENT_ID,
        metric_key: SOCIAL_METRIC,
        window_days: 21,
        baseline: 100,
        after_value: 130,
        delta: 30,
        delta_pct: 30,
        confidence: 0.9,
        verdict: 'confirmed',
        evaluator_key: null,
        computed_at: '2026-06-10T00:00:00.000Z',
      },
    ])

    await runJob(14)

    const legacy = db.outcomes().find(r => r.window_days === 21)
    expect(legacy?.evaluator_key).toBe(OUTCOME_EVALUATOR.FLYWHEEL_METRICS)
    expect(legacy?.id).toBe('legacy-21')
  })

  it('signs an immature action\u2019s row even though there is no baseline yet', async () => {
    // processAction returns false at the missing baseline, long before the
    // upsert. Reconciling only after a successful write would leave this row
    // unsigned for as long as the action has no metrics — and the rollout's
    // NULL-count gate would sit blocked on it. (Codex P2, round 16.)
    process.env[DUAL_WINDOW_FLAG] = 'true'
    db.seed('flywheel_actions', [
      {
        id: 'action-social-1', client_id: CLIENT_ID, flywheel: 'social',
        action_type: 'social.publish', expected_metric: SOCIAL_METRIC,
        expected_delta: 1, executed_at: EXECUTED_AT, payload: null,
      },
    ])
    // Deliberately no flywheel_metrics rows at all.
    db.seed('flywheel_outcomes', [
      {
        id: 'legacy-21', action_id: 'action-social-1', client_id: CLIENT_ID,
        metric_key: SOCIAL_METRIC, window_days: 21,
        baseline: 100, after_value: 130, delta: 30, delta_pct: 30,
        confidence: 0.9, verdict: 'confirmed', evaluator_key: null,
        computed_at: '2026-06-10T00:00:00.000Z',
      },
    ])

    const result = await runJob(14)

    expect(result.written).toBe(0) // nothing to attribute yet
    expect(db.outcomes().find(r => r.id === 'legacy-21')?.evaluator_key)
      .toBe(OUTCOME_EVALUATOR.FLYWHEEL_METRICS)
  })

  it('does not disown a landed write when the claim fails', async () => {
    seedSocialAction()
    db.failNext('flywheel_outcomes', 'update', 'connection reset')

    const result = await runJob(14)

    // The outcome for window 14 was written; a failed claim is reconciliation
    // debt, not a failed attribution. The contract migration's preflight is
    // what refuses to let it decay into a silent hole — it aborts on NULLs.
    expect(result.written).toBe(1)
    expect(result.failed).toBe(0)
  })
})

// ── The gate's real promise: one window per action in production ────────────

describe('with dual-window OFF, an action never ends up holding two windows', () => {
  it('retires the legacy 7-day row instead of merely signing it', async () => {
    // Signing alone was not enough, and this is the finding that showed it: the
    // action would hold BOTH a 7-day and a 28-day answer, and the memory
    // consumers still count outcome ROWS — so its evidence is doubled while the
    // gate is supposedly holding production at one window. On main this could
    // not happen, because every writer DELETEd by action before inserting.
    seedSeoAction()
    seedGscSnapshots()
    seedUnsignedRow()

    await runBridge(28)

    const windows = db.outcomes().map(r => r.window_days)
    expect(new Set(windows)).toEqual(new Set([28]))
    expect(db.outcomes().filter(r => r.action_id === ACTION_ID)).toHaveLength(3)
  })

  it('keeps both windows once dual-window is enabled', async () => {
    // Same inputs, flag on: the extra window is legitimate and is preserved.
    // Without this pair, "retire everything else" and "the gate does nothing"
    // would look identical.
    process.env[DUAL_WINDOW_FLAG] = 'true'
    seedSeoAction()
    seedGscSnapshots()
    seedUnsignedRow()

    await runBridge(28)

    expect(new Set(db.outcomes().map(r => r.window_days))).toEqual(new Set([7, 28]))
  })

  it('does not touch the OTHER evaluator\'s rows when retiring windows', async () => {
    // The retire is scoped to our own evaluator_key. A flywheel_metrics row at
    // a different window is not ours to withdraw, and this PR exists because
    // writers used to delete each other's evidence.
    seedSeoAction()
    seedGscSnapshots()
    db.seed('flywheel_outcomes', [
      {
        id: 'other-14',
        action_id: ACTION_ID,
        client_id: CLIENT_ID,
        metric_key: SOCIAL_METRIC,
        window_days: 14,
        baseline: 1, after_value: 2, delta: 1, delta_pct: 100,
        confidence: 0.5, verdict: 'confirmed',
        evaluator_key: OUTCOME_EVALUATOR.FLYWHEEL_METRICS,
        computed_at: '2026-06-10T00:00:00.000Z',
      },
    ])

    await runBridge(28)

    expect(db.outcomes().find(r => r.id === 'other-14')).toBeDefined()
  })

  it('pass 1 retires its own non-authoritative windows too', async () => {
    db.seed('flywheel_actions', [
      {
        id: 'action-social-1', client_id: CLIENT_ID, flywheel: 'social',
        action_type: 'social.publish', expected_metric: SOCIAL_METRIC,
        expected_delta: 1, executed_at: EXECUTED_AT, payload: null,
      },
    ])
    db.seed('flywheel_metrics', [
      { client_id: CLIENT_ID, metric_key: SOCIAL_METRIC, metric_value: 100, measured_at: '2026-05-30T00:00:00.000Z' },
      { client_id: CLIENT_ID, metric_key: SOCIAL_METRIC, metric_value: 140, measured_at: '2026-06-05T00:00:00.000Z' },
    ])
    db.seed('flywheel_outcomes', [
      {
        id: 'legacy-21', action_id: 'action-social-1', client_id: CLIENT_ID,
        metric_key: SOCIAL_METRIC, window_days: 21,
        baseline: 100, after_value: 130, delta: 30, delta_pct: 30,
        confidence: 0.9, verdict: 'confirmed', evaluator_key: null,
        computed_at: '2026-06-10T00:00:00.000Z',
      },
    ])

    await runJob(14)

    expect(db.outcomes().map(r => r.window_days)).toEqual([14])
  })
})

// ── Why the claim is needed at all ───────────────────────────────────────────

describe('the ordinary write path cannot reach these rows', () => {
  it('a cadence run does not touch a 7-day row on its own', async () => {
    // Without the claim this is the whole bug: the run succeeds, writes its own
    // three rows, and the unsigned one is simply never visited.
    process.env[DUAL_WINDOW_FLAG] = 'true'
    seedSeoAction()
    seedGscSnapshots()
    seedUnsignedRow()

    await runBridge(28)

    const rows = db.outcomes()
    // Four rows total — the legacy one was NOT replaced or deleted by the run.
    expect(rows).toHaveLength(4)
    expect(rows.filter(r => r.window_days === 28)).toHaveLength(3)
    // Which is exactly why signing it has to be an explicit step.
    expect(rows.find(r => r.window_days === 7)?.id).toBe('legacy-1')
  })

  it('leaves no unsigned row behind for the contract migration to trip on', async () => {
    process.env[DUAL_WINDOW_FLAG] = 'true'
    seedSeoAction()
    seedGscSnapshots()
    seedUnsignedRow()

    await runBridge(28)

    const unsigned = db.outcomes().filter(r => r.evaluator_key == null)
    expect(unsigned).toEqual([])
  })
})
