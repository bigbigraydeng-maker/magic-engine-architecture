/**
 * Delivery scoring and the hard gates.
 *
 * The tests that matter here are the ones proving a *high score cannot buy a
 * pass*. A PR that documents itself beautifully while its CI is red, or whose
 * rating was computed against a commit that no longer exists, must be blocked
 * at 100/100 — otherwise the score becomes the thing agents optimise and the
 * gate becomes decorative.
 */

import { describe, expect, it } from 'vitest'

import {
  A_REQUIRED_SIGNALS,
  CODEX_QUALITY_FIELDS,
  READY_THRESHOLD,
  SCORE_DIMENSIONS,
  decideReadiness,
  knownSignalIds,
  scoreDelivery,
} from '../src/quality.mjs'

const ALL_SIGNALS = knownSignalIds()

const cleanGates = {
  evidenceReadable: true,
  shaMatches: true,
  requiredCiPassed: true,
  openBlockerCount: 0,
}

describe('the scoring table itself', () => {
  it('is worth exactly 100', () => {
    expect(SCORE_DIMENSIONS.reduce((sum: number, d: { max: number }) => sum + d.max, 0)).toBe(100)
  })

  it('gives each dimension exactly the weight the spec assigns it', () => {
    const byKey = Object.fromEntries(
      SCORE_DIMENSIONS.map((d: { key: string; max: number }) => [d.key, d.max]),
    )
    expect(byKey).toEqual({ acceptance: 30, tests: 25, security: 20, reuse: 15, resilience: 10 })
  })

  it('has every dimension"s signals summing to its own max — no scoring out of 103', () => {
    for (const dimension of SCORE_DIMENSIONS as Array<{
      key: string
      max: number
      signals: Array<{ points: number }>
    }>) {
      const sum = dimension.signals.reduce((total, s) => total + s.points, 0)
      expect(sum, `${dimension.key} signals must sum to ${dimension.max}`).toBe(dimension.max)
    }
  })

  it('reports Codex quality fields as unavailable rather than inventing them', () => {
    expect(CODEX_QUALITY_FIELDS).toBe('unavailable')
  })
})

describe('scoreDelivery only counts evidence it was handed', () => {
  it('scores 0 with no signals — missing evidence is 0, not a benefit of the doubt', () => {
    expect(scoreDelivery({}).total).toBe(0)
    expect(scoreDelivery({ signals: [] }).total).toBe(0)
  })

  it('scores 100 with every signal', () => {
    expect(scoreDelivery({ signals: ALL_SIGNALS }).total).toBe(100)
  })

  it('adds up partial evidence per dimension', () => {
    const result = scoreDelivery({ signals: ['linked-issue', 'required-ci-green', 'reuse-statement'] })
    expect(result.total).toBe(30)
    const acceptance = result.dimensions.find((d: { key: string }) => d.key === 'acceptance')
    expect(acceptance?.awarded).toBe(10)
    expect(acceptance?.missing).toEqual(['acceptance-criteria', 'scope-statement'])
  })

  it('refuses an invented signal instead of silently ignoring it', () => {
    expect(() => scoreDelivery({ signals: ['looks-good-to-me'] })).toThrow(/unknown evidence signal/)
  })

  it('counts a repeated signal once', () => {
    expect(scoreDelivery({ signals: ['linked-issue', 'linked-issue'] }).total).toBe(10)
  })
})

describe('hard gates outrank the total', () => {
  const perfect = { total: 100 }

  it('is ready at threshold with clean gates', () => {
    const result = decideReadiness({
      risk: 'B',
      score: { total: READY_THRESHOLD.B },
      gates: cleanGates,
      observedSignals: ALL_SIGNALS,
    })
    expect(result.decision).toBe('READY_FOR_PRODUCT_OWNER')
    expect(result.blockers).toEqual([])
  })

  it('blocks a 100-point PR whose required CI is red', () => {
    const result = decideReadiness({
      risk: 'B',
      score: perfect,
      gates: { ...cleanGates, requiredCiPassed: false },
      observedSignals: ALL_SIGNALS,
    })
    expect(result.ready).toBe(false)
    expect(result.blockers.join('\n')).toContain('必过 CI 未通过')
  })

  it('blocks a 100-point PR with an open Codex P0/P1/P2 on the current head', () => {
    const result = decideReadiness({
      risk: 'B',
      score: perfect,
      gates: { ...cleanGates, openBlockerCount: 2 },
      observedSignals: ALL_SIGNALS,
    })
    expect(result.ready).toBe(false)
    expect(result.blockers.join('\n')).toContain('2 条 Codex P0/P1/P2')
  })

  it('blocks a 100-point PR whose rating is bound to a stale sha', () => {
    const result = decideReadiness({
      risk: 'B',
      score: perfect,
      gates: { ...cleanGates, shaMatches: false },
      observedSignals: ALL_SIGNALS,
    })
    expect(result.ready).toBe(false)
    expect(result.blockers.join('\n')).toContain('对不上')
  })

  it('blocks an A-level PR missing its specialised evidence, however high it scores', () => {
    const withoutIsolation = ALL_SIGNALS.filter((id: string) => id !== 'isolation-evidence')
    const result = decideReadiness({
      risk: 'A',
      score: { total: 90 },
      gates: cleanGates,
      observedSignals: withoutIsolation,
    })
    expect(result.ready).toBe(false)
    expect(result.blockers.join('\n')).toContain('isolation-evidence')
  })

  it('keeps the A-required list and the scoring table in sync', () => {
    for (const id of A_REQUIRED_SIGNALS as string[]) {
      expect(ALL_SIGNALS).toContain(id)
    }
  })
})

describe('unreadable evidence fails closed', () => {
  it.each([
    ['evidenceReadable missing', { shaMatches: true, requiredCiPassed: true, openBlockerCount: 0 }],
    ['CI status unreadable', { ...cleanGates, requiredCiPassed: null }],
    ['Codex blocker count unreadable', { ...cleanGates, openBlockerCount: null }],
    ['no gates at all', undefined],
  ])('%s blocks', (_label, gates) => {
    const result = decideReadiness({
      risk: 'C',
      score: { total: 100 },
      gates,
      observedSignals: ALL_SIGNALS,
    })
    expect(result.ready).toBe(false)
    expect(result.blockers.length).toBeGreaterThan(0)
  })

  it('blocks when the score itself could not be computed', () => {
    const result = decideReadiness({ risk: 'C', score: {}, gates: cleanGates, observedSignals: ALL_SIGNALS })
    expect(result.ready).toBe(false)
    expect(result.blockers.join('\n')).toContain('质量分算不出来')
  })

  it('lists every blocker at once, not just the first', () => {
    const result = decideReadiness({
      risk: 'A',
      score: { total: 10 },
      gates: { evidenceReadable: false, shaMatches: false, requiredCiPassed: false, openBlockerCount: 3 },
      observedSignals: [],
    })
    expect(result.blockers.length).toBeGreaterThanOrEqual(5)
  })
})

describe('the thresholds are per level', () => {
  it('applies 75 / 85 / 90', () => {
    expect(READY_THRESHOLD).toEqual({ A: 90, B: 85, C: 75 })
  })

  it.each([
    ['C', 74, false],
    ['C', 75, true],
    ['B', 84, false],
    ['B', 85, true],
  ])('%s at %i is ready=%s', (risk, total, expected) => {
    const result = decideReadiness({
      risk,
      score: { total },
      gates: cleanGates,
      observedSignals: ALL_SIGNALS,
    })
    expect(result.ready).toBe(expected)
  })

  it('uses the strictest threshold for a level it does not recognise', () => {
    const result = decideReadiness({
      risk: 'nonsense',
      score: { total: 89 },
      gates: cleanGates,
      observedSignals: ALL_SIGNALS,
    })
    expect(result.threshold).toBe(90)
    expect(result.ready).toBe(false)
  })
})

describe('NEEDS_PRODUCT_DECISION is never inferred', () => {
  it('does not appear just because the PR is blocked and stuck', () => {
    const result = decideReadiness({
      risk: 'A',
      score: { total: 0 },
      gates: { ...cleanGates, requiredCiPassed: false },
      observedSignals: [],
    })
    expect(result.decision).toBe('BLOCKED')
  })

  it('appears only when the caller asserts a real business question', () => {
    const result = decideReadiness({
      risk: 'B',
      score: { total: 100 },
      gates: { ...cleanGates, productDecisionNeeded: true, productDecisionReason: '客户是否接受多花 $200' },
      observedSignals: ALL_SIGNALS,
    })
    expect(result.decision).toBe('NEEDS_PRODUCT_DECISION')
    expect(result.ready).toBe(false)
    expect(result.productDecisionReason).toBe('客户是否接受多花 $200')
  })
})
