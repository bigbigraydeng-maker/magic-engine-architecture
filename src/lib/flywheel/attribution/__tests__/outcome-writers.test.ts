/**
 * flywheel_outcomes writer-coexistence and idempotency — Issue #859.
 *
 * Both attribution writers share one table. These tests pin the invariants that
 * were previously unenforced:
 *
 *   1. one action legitimately has many metric rows;
 *   2. the same metric legitimately has rows at more than one window;
 *   3. the two writers coexist;
 *   4. neither writer removes the other's rows — even on re-run or failure;
 *   5. re-running is idempotent AND keeps flywheel_outcomes.id stable;
 *   6. a failed write does not leave the action with nothing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FakeOutcomesDb } from './fake-outcomes-db'
import { OUTCOME_EVALUATOR } from '../outcome-identity'

// ── Module-level fake, swapped per test ──────────────────────────────────────

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

function seedSeoAction(overrides: Record<string, unknown> = {}): void {
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
      ...overrides,
    },
  ])
}

/** flywheel_metrics rows the job.ts evaluator needs: one before, one inside the window. */
function seedFlywheelMetrics(metricKey = GSC_CLICKS): void {
  db.seed('flywheel_metrics', [
    { client_id: CLIENT_ID, metric_key: metricKey, metric_value: 100, measured_at: '2026-05-30T00:00:00.000Z' },
    { client_id: CLIENT_ID, metric_key: metricKey, metric_value: 140, measured_at: '2026-06-05T00:00:00.000Z' },
  ])
}

/** gsc_performance_snapshots rows the gsc-bridge evaluator needs. */
function seedGscSnapshots(topPages: unknown = null): void {
  db.seed('gsc_performance_snapshots', [
    {
      client_id: CLIENT_ID,
      period_end: '2026-05-31',
      total_clicks: 100,
      total_impressions: 1000,
      avg_position: 20,
      top_pages: topPages,
    },
    {
      client_id: CLIENT_ID,
      period_end: '2026-07-15',
      total_clicks: 150,
      total_impressions: 1600,
      avg_position: 12,
      top_pages: topPages,
    },
  ])
}

async function runJob(windowDays?: number) {
  const { runAttributionJob } = await import('../job')
  return runAttributionJob({ clientId: CLIENT_ID, windowDays })
}

async function runBridge(windowDays = 28) {
  const { runGscAttributionForClient } = await import('../gsc-bridge')
  return runGscAttributionForClient(CLIENT_ID, windowDays)
}

beforeEach(() => {
  db = new FakeOutcomesDb()
  vi.clearAllMocks()
})

// ── 1. One action, many metrics ──────────────────────────────────────────────

describe('one action carries many metric rows', () => {
  it('the GSC evaluator writes three domain rows for a single action', async () => {
    seedSeoAction()
    seedGscSnapshots()

    const result = await runBridge()

    expect(result.outcomes_written).toBe(3)
    const rows = db.outcomes()
    expect(rows).toHaveLength(3)
    expect(new Set(rows.map(r => r.metric_key))).toEqual(
      new Set(['seo.gsc.clicks', 'seo.gsc.impressions', 'seo.gsc.avg_position']),
    )
    // All three belong to the same action — action_id alone cannot be the key.
    expect(new Set(rows.map(r => r.action_id))).toEqual(new Set([ACTION_ID]))
  })
})

// ── 2. Same metric, different windows ────────────────────────────────────────

describe('the same metric coexists at different windows', () => {
  it('a 14-day and a 28-day answer for one metric are two separate rows', async () => {
    seedSeoAction()
    seedFlywheelMetrics()
    seedGscSnapshots()

    await runJob(14) // job.ts writes seo.gsc.clicks @ 14
    await runBridge(28) // gsc-bridge writes seo.gsc.clicks @ 28 (plus two more)

    const clicksRows = db.outcomes().filter(r => r.metric_key === GSC_CLICKS)
    expect(clicksRows.map(r => r.window_days).sort()).toEqual([14, 28])
    expect(clicksRows.map(r => r.evaluator_key).sort()).toEqual([
      OUTCOME_EVALUATOR.FLYWHEEL_METRICS,
      OUTCOME_EVALUATOR.GSC_SNAPSHOTS,
    ])
  })
})

// ── 3 + 4. Two writers coexist; neither deletes the other's rows ─────────────

describe('writer coexistence', () => {
  it('both writers land rows for the same action', async () => {
    seedSeoAction({ expected_metric: 'seo.domain.organic_traffic' })
    seedFlywheelMetrics('seo.domain.organic_traffic')
    seedGscSnapshots()

    await runJob(14)
    await runBridge(28)

    expect(db.outcomes()).toHaveLength(4)
  })

  it('re-running the flywheel_metrics writer does not touch the GSC writer rows', async () => {
    seedSeoAction({ expected_metric: 'seo.domain.organic_traffic' })
    seedFlywheelMetrics('seo.domain.organic_traffic')
    seedGscSnapshots()

    await runBridge(28)
    const gscIdsBefore = db
      .outcomes()
      .filter(r => r.evaluator_key === OUTCOME_EVALUATOR.GSC_SNAPSHOTS)
      .map(r => r.id)
      .sort()
    expect(gscIdsBefore).toHaveLength(3)

    await runJob(14)
    await runJob(14) // and again — re-runs must stay harmless

    const gscIdsAfter = db
      .outcomes()
      .filter(r => r.evaluator_key === OUTCOME_EVALUATOR.GSC_SNAPSHOTS)
      .map(r => r.id)
      .sort()

    expect(gscIdsAfter).toEqual(gscIdsBefore)
  })

  it('the flywheel_metrics writer issues no DELETE against flywheel_outcomes at all', async () => {
    seedSeoAction({ expected_metric: 'seo.domain.organic_traffic' })
    seedFlywheelMetrics('seo.domain.organic_traffic')

    await runJob(14)

    // The old code ran DELETE WHERE action_id = ?, which is exactly how it
    // destroyed the other writer's rows. There is now no delete path here.
    expect(db.didDeleteFrom('flywheel_outcomes')).toBe(false)
  })

  it('the GSC writer scopes its retire to its own evaluator and window', async () => {
    // A page-scope action: the bridge writes page rows and retires the domain
    // rows it previously owned — but must leave the other writer alone.
    seedSeoAction({
      action_type: 'cms_update_existing',
      payload: { status: 'live', page_url: 'https://example.com/guide' },
    })
    seedFlywheelMetrics()
    seedGscSnapshots([{ page: 'https://example.com/guide', clicks: 40, impressions: 400, position: 18 }])

    await runJob(14) // seo.gsc.clicks @ 14, evaluator = flywheel_metrics
    await runBridge(28) // page rows @ 28 + retire of domain rows @ 28

    const rows = db.outcomes()
    const survivor = rows.find(
      r => r.evaluator_key === OUTCOME_EVALUATOR.FLYWHEEL_METRICS,
    )

    expect(survivor).toBeDefined()
    expect(survivor?.metric_key).toBe(GSC_CLICKS)
    expect(survivor?.window_days).toBe(14)

    // Only page-scope keys remain for the GSC evaluator.
    const gscKeys = rows
      .filter(r => r.evaluator_key === OUTCOME_EVALUATOR.GSC_SNAPSHOTS)
      .map(r => r.metric_key)
      .sort()
    expect(gscKeys).toEqual([
      'seo.gsc.page_avg_position',
      'seo.gsc.page_clicks',
      'seo.gsc.page_impressions',
    ])

    const retire = db.ops.find(o => o.table === 'flywheel_outcomes' && o.op === 'delete')
    expect(retire).toBeDefined()
    expect(retire?.filters.map(f => f.column).sort()).toEqual([
      'action_id',
      'evaluator_key',
      'metric_key',
      'window_days',
    ])
  })

  it('the GSC retire cannot remove another evaluator row that shares its window', async () => {
    // Reachable today: the attribution cron accepts ?window_days=28, which makes
    // the flywheel_metrics writer land seo.gsc.clicks at the very window the GSC
    // writer retires from. Only the evaluator_key scope keeps them apart.
    seedSeoAction({
      action_type: 'cms_update_existing',
      payload: { status: 'live', page_url: 'https://example.com/guide' },
    })
    seedFlywheelMetrics()
    seedGscSnapshots([{ page: 'https://example.com/guide', clicks: 40, impressions: 400, position: 18 }])

    await runJob(28) // seo.gsc.clicks @ 28, evaluator = flywheel_metrics
    await runBridge(28) // page rows @ 28, retires domain keys @ 28

    const survivor = db
      .outcomes()
      .find(r => r.evaluator_key === OUTCOME_EVALUATOR.FLYWHEEL_METRICS)

    expect(survivor).toBeDefined()
    expect(survivor?.metric_key).toBe(GSC_CLICKS)
    expect(survivor?.window_days).toBe(28)
  })
})

// ── 5. Idempotent retry ──────────────────────────────────────────────────────

describe('retry idempotency', () => {
  it('re-running the GSC writer keeps three rows with the same ids', async () => {
    seedSeoAction()
    seedGscSnapshots()

    await runBridge(28)
    const first = db.outcomes().map(r => ({ id: r.id, key: r.metric_key })).sort(byKey)

    await runBridge(28)
    await runBridge(28)
    const third = db.outcomes().map(r => ({ id: r.id, key: r.metric_key })).sort(byKey)

    expect(third).toHaveLength(3)
    expect(third).toEqual(first)
  })

  it('re-running the flywheel_metrics writer keeps one row with the same id', async () => {
    seedSeoAction({ expected_metric: 'seo.domain.organic_traffic' })
    seedFlywheelMetrics('seo.domain.organic_traffic')

    await runJob(14)
    const firstId = db.outcomes()[0].id

    await runJob(14)

    expect(db.outcomes()).toHaveLength(1)
    expect(db.outcomes()[0].id).toBe(firstId)
  })

  it('an updated recomputation overwrites in place rather than adding a row', async () => {
    seedSeoAction({ expected_metric: 'seo.domain.organic_traffic' })
    seedFlywheelMetrics('seo.domain.organic_traffic')

    await runJob(14)
    const id = db.outcomes()[0].id
    expect(db.outcomes()[0].verdict).toBe('confirmed')

    // The metric reverses: a later measurement drops well below baseline.
    db.rowsOf('flywheel_metrics').push({
      id: 'm-3',
      client_id: CLIENT_ID,
      metric_key: 'seo.domain.organic_traffic',
      metric_value: 50,
      measured_at: '2026-06-10T00:00:00.000Z',
    })

    await runJob(14)

    expect(db.outcomes()).toHaveLength(1)
    expect(db.outcomes()[0].id).toBe(id) // same business outcome, same identity
    expect(db.outcomes()[0].verdict).toBe('reversed') // trackable state change
  })
})

// ── 6. Partial failure ───────────────────────────────────────────────────────

describe('partial failure', () => {
  it('a failed GSC write leaves the previous rows in place', async () => {
    seedSeoAction()
    seedGscSnapshots()

    await runBridge(28)
    const before = db.outcomes().map(r => r.id).sort()
    expect(before).toHaveLength(3)

    db.failNext('flywheel_outcomes', 'upsert', 'connection reset')
    const result = await runBridge(28)

    expect(result.errors.join(' ')).toContain('connection reset')
    expect(db.outcomes().map(r => r.id).sort()).toEqual(before)
  })

  it('a failed GSC write does not run the retire step', async () => {
    seedSeoAction({
      action_type: 'cms_update_existing',
      payload: { status: 'live', page_url: 'https://example.com/guide' },
    })
    seedGscSnapshots([{ page: 'https://example.com/guide', clicks: 40, impressions: 400, position: 18 }])

    db.failNext('flywheel_outcomes', 'upsert', 'write timeout')
    await runBridge(28)

    expect(db.didDeleteFrom('flywheel_outcomes')).toBe(false)
  })

  it('one failing action does not abort the rest of the client run', async () => {
    seedSeoAction()
    db.seed('flywheel_actions', [
      {
        id: 'action-seo-2',
        client_id: CLIENT_ID,
        flywheel: 'seo',
        action_type: 'seo.publish_blog',
        expected_metric: GSC_CLICKS,
        expected_delta: 1,
        executed_at: EXECUTED_AT,
        payload: null,
      },
    ])
    seedGscSnapshots()

    db.failNext('flywheel_outcomes', 'upsert', 'transient')
    const result = await runBridge(28)

    expect(result.errors).toHaveLength(1)
    expect(result.outcomes_written).toBe(3) // the second action still landed
  })
})

// ── 7. Historical duplicates ─────────────────────────────────────────────────

describe('historical duplicate rows', () => {
  it('a plain INSERT of a duplicate natural key is rejected once the constraint exists', async () => {
    seedSeoAction()
    db.seed('flywheel_outcomes', [
      {
        id: 'legacy-1',
        action_id: ACTION_ID,
        client_id: CLIENT_ID,
        metric_key: GSC_CLICKS,
        window_days: 28,
        verdict: 'inconclusive',
        evaluator_key: OUTCOME_EVALUATOR.GSC_SNAPSHOTS,
      },
    ])

    const { error } = await db.from('flywheel_outcomes').insert({
      action_id: ACTION_ID,
      client_id: CLIENT_ID,
      metric_key: GSC_CLICKS,
      window_days: 28,
      verdict: 'confirmed',
      evaluator_key: OUTCOME_EVALUATOR.GSC_SNAPSHOTS,
    })

    expect(error?.message).toContain('flywheel_outcomes_natural_key')
  })

  it('a pre-existing row is adopted by the writer instead of duplicated', async () => {
    seedSeoAction()
    seedGscSnapshots()
    db.seed('flywheel_outcomes', [
      {
        id: 'legacy-1',
        action_id: ACTION_ID,
        client_id: CLIENT_ID,
        metric_key: GSC_CLICKS,
        window_days: 28,
        verdict: 'inconclusive',
        evaluator_key: OUTCOME_EVALUATOR.GSC_SNAPSHOTS,
      },
    ])

    await runBridge(28)

    const clicks = db.outcomes().filter(r => r.metric_key === GSC_CLICKS)
    expect(clicks).toHaveLength(1)
    expect(clicks[0].id).toBe('legacy-1') // identity survives the recomputation
    expect(clicks[0].verdict).toBe('confirmed')
  })
})

function byKey(a: { key: unknown }, b: { key: unknown }): number {
  return String(a.key).localeCompare(String(b.key))
}
