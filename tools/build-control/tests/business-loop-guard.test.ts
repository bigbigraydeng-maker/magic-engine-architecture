import { describe, expect, it } from 'vitest'
import { IMPACT_LOOP_LABEL, evaluateBusinessLoopClosure } from '../src/business-loop-guard.mjs'
import { serializeOutcomeReceipt } from '../src/outcome-receipt.mjs'

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    recorded_by: 'owner',
    execution: { status: 'DONE', evidence: 'PR #1227 merged' },
    activation: { status: 'UNKNOWN' },
    measurement: { status: 'DONE', evidence: 'T+24 comparison recorded' },
    outcome: { status: 'DONE', evidence: 'classified NO_LIFT' },
    tune: { status: 'DONE', evidence: 'next decision recorded' },
    ...overrides,
  }
}

const comment = (author: string, payload: unknown) => ({ author, body: serializeOutcomeReceipt(payload) })
const allowlist = ['owner']

describe('evaluateBusinessLoopClosure', () => {
  // Applying `impact-loop` is an owner rollout action; an unlabelled Issue is
  // simply out of scope, which is why a repository with no such label yet is a
  // deterministic no-op rather than a failure.
  it('does not apply to an Issue without the impact-loop label', () => {
    expect(evaluateBusinessLoopClosure({ labels: ['bug'], comments: [], allowlist })).toEqual({
      status: 'NOT_APPLICABLE',
    })
    expect(evaluateBusinessLoopClosure({ labels: [], comments: [], allowlist })).toEqual({ status: 'NOT_APPLICABLE' })
  })

  it('is incomplete when an impact-loop Issue has no receipt at all', () => {
    const result = evaluateBusinessLoopClosure({ labels: [IMPACT_LOOP_LABEL], comments: [], allowlist })
    expect(result.status).toBe('INCOMPLETE')
  })

  it('is complete with a trusted receipt whose four stages are DONE with evidence', () => {
    const result = evaluateBusinessLoopClosure({
      labels: [IMPACT_LOOP_LABEL],
      comments: [comment('owner', receipt())],
      allowlist,
    })
    expect(result.status).toBe('COMPLETE')
  })

  // A random commenter cannot close an impact-loop Issue, even with a payload
  // that would otherwise be complete.
  it('is incomplete when the only complete receipt comes from an untrusted author', () => {
    const result = evaluateBusinessLoopClosure({
      labels: [IMPACT_LOOP_LABEL],
      comments: [comment('drive-by', receipt({ recorded_by: 'drive-by' }))],
      allowlist,
    })
    expect(result.status).toBe('INCOMPLETE')
    expect(result.status === 'INCOMPLETE' && result.reasons.some((r) => r.includes('drive-by'))).toBe(true)
  })

  it('is incomplete with an execution-only receipt', () => {
    const executionOnly = receipt({
      measurement: { status: 'PENDING' },
      outcome: { status: 'PENDING' },
      tune: { status: 'PENDING' },
    })
    const result = evaluateBusinessLoopClosure({
      labels: [IMPACT_LOOP_LABEL],
      comments: [comment('owner', executionOnly)],
      allowlist,
    })
    expect(result.status).toBe('INCOMPLETE')
  })

  it('reads the latest trusted receipt across multiple comments', () => {
    const result = evaluateBusinessLoopClosure({
      labels: [IMPACT_LOOP_LABEL],
      comments: [comment('owner', receipt()), comment('owner', receipt({ tune: { status: 'PENDING' } }))],
      allowlist,
    })
    expect(result.status).toBe('INCOMPLETE')
  })
})
