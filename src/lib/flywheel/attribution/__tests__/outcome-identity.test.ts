import { describe, it, expect } from 'vitest'
import {
  GSC_EVALUATOR_METRIC_KEYS,
  OUTCOME_CONFLICT_TARGET,
  OUTCOME_EVALUATOR,
  buildOutcomeKey,
  keepOneMeasurementPerAction,
  resolveStaleEvaluatorKeys,
} from '../outcome-identity'

describe('buildOutcomeKey', () => {
  it('matches the outcome_key generated column expression', () => {
    expect(buildOutcomeKey('a1', 'seo.gsc.clicks', 28)).toBe('a1:seo.gsc.clicks:28')
  })

  it('distinguishes the same metric measured over different windows', () => {
    expect(buildOutcomeKey('a1', 'seo.gsc.clicks', 14)).not.toBe(
      buildOutcomeKey('a1', 'seo.gsc.clicks', 28),
    )
  })
})

describe('resolveStaleEvaluatorKeys', () => {
  it('returns the owned keys that were not produced this run', () => {
    const stale = resolveStaleEvaluatorKeys(
      GSC_EVALUATOR_METRIC_KEYS,
      ['seo.gsc.page_clicks', 'seo.gsc.page_impressions', 'seo.gsc.page_avg_position'],
    )
    expect(stale.sort()).toEqual([
      'seo.gsc.avg_position',
      'seo.gsc.clicks',
      'seo.gsc.impressions',
    ])
  })

  it('returns nothing when every owned key was produced', () => {
    expect(resolveStaleEvaluatorKeys(GSC_EVALUATOR_METRIC_KEYS, [...GSC_EVALUATOR_METRIC_KEYS]))
      .toEqual([])
  })

  it('retires nothing when the run produced nothing — a barren run is not a refutation', () => {
    expect(resolveStaleEvaluatorKeys(GSC_EVALUATOR_METRIC_KEYS, [])).toEqual([])
  })

  it('never reports a key the evaluator does not own', () => {
    const stale = resolveStaleEvaluatorKeys(GSC_EVALUATOR_METRIC_KEYS, ['seo.gsc.clicks'])
    expect(stale).not.toContain('seo.domain.organic_traffic')
    expect(stale.every(k => GSC_EVALUATOR_METRIC_KEYS.includes(k))).toBe(true)
  })
})

describe('evaluator vocabulary', () => {
  it('keeps the two writers on distinct labels', () => {
    expect(OUTCOME_EVALUATOR.FLYWHEEL_METRICS).not.toBe(OUTCOME_EVALUATOR.GSC_SNAPSHOTS)
  })

  it('excludes evaluator_key from the natural key', () => {
    // Two evaluators answering the same (action, metric, window) question are
    // competing answers to one fact, not two facts.
    expect(OUTCOME_CONFLICT_TARGET).not.toContain('evaluator_key')
  })
})

// ── One action is one piece of evidence, however many windows it has ────────
//
// Deferred actions are computed at the bridge's cadence AND at pass 1's window,
// so counting rows makes one action look like two. `industry_benchmarks` needs
// three samples before it will write a client-facing number, and Huatuo reports
// "client cases" from the same table — both would be inflated 2x.

describe('keepOneMeasurementPerAction', () => {
  const row = (action_id: string, metric_key: string, window_days: number | null) =>
    ({ action_id, metric_key, window_days })

  it('collapses the two windows of one action-metric into one measurement', () => {
    const kept = keepOneMeasurementPerAction([
      row('a1', 'seo.gsc.clicks', 28),
      row('a1', 'seo.gsc.clicks', 14),
    ])

    expect(kept).toHaveLength(1)
  })

  it('keeps the longest window — the most mature observation', () => {
    expect(keepOneMeasurementPerAction([
      row('a1', 'seo.gsc.clicks', 14),
      row('a1', 'seo.gsc.clicks', 28),
    ])[0].window_days).toBe(28)

    // …and does not depend on row order.
    expect(keepOneMeasurementPerAction([
      row('a1', 'seo.gsc.clicks', 28),
      row('a1', 'seo.gsc.clicks', 14),
    ])[0].window_days).toBe(28)
  })

  it('keeps different metrics of the same action apart', () => {
    const kept = keepOneMeasurementPerAction([
      row('a1', 'seo.gsc.clicks', 28),
      row('a1', 'seo.gsc.impressions', 28),
      row('a1', 'seo.gsc.avg_position', 28),
    ])

    expect(kept).toHaveLength(3)
  })

  it('keeps different actions apart', () => {
    const kept = keepOneMeasurementPerAction([
      row('a1', 'seo.gsc.clicks', 28),
      row('a2', 'seo.gsc.clicks', 28),
    ])

    expect(kept).toHaveLength(2)
  })

  it('does not let two dual-window actions look like four samples', () => {
    // The concrete failure: MIN_SAMPLE_THRESHOLD is 3, so four rows from two
    // actions would cross it and write a benchmark on half the real evidence.
    const kept = keepOneMeasurementPerAction([
      row('a1', 'seo.gsc.clicks', 28), row('a1', 'seo.gsc.clicks', 14),
      row('a2', 'seo.gsc.clicks', 28), row('a2', 'seo.gsc.clicks', 14),
    ])

    expect(kept).toHaveLength(2)
    expect(kept.every(r => r.window_days === 28)).toBe(true) // no mixed windows
  })

  it('prefers a real window over a null one', () => {
    expect(keepOneMeasurementPerAction([
      row('a1', 'seo.gsc.clicks', null),
      row('a1', 'seo.gsc.clicks', 14),
    ])[0].window_days).toBe(14)
  })

  it('is a no-op on an already-deduped set', () => {
    const rows = [row('a1', 'seo.gsc.clicks', 28), row('a2', 'seo.gsc.impressions', 14)]
    expect(keepOneMeasurementPerAction(rows)).toHaveLength(2)
  })
})
