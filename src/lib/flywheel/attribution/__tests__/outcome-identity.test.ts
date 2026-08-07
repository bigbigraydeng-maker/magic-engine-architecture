import { describe, it, expect } from 'vitest'
import {
  GSC_EVALUATOR_METRIC_KEYS,
  OUTCOME_CONFLICT_TARGET,
  OUTCOME_EVALUATOR,
  buildOutcomeKey,
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
