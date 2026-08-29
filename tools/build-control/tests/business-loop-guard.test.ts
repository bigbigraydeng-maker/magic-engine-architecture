import { describe, expect, it } from 'vitest'
import { evaluateBusinessLoopClosure, IMPACT_LOOP_LABEL } from '../src/business-loop-guard.mjs'
import { serializeOutcomeReceipt } from '../src/outcome-receipt.mjs'

function receipt(overrides: Record<string, { status: string }> = {}) {
  return {
    execution: { status: 'DONE' },
    activation: { status: 'UNKNOWN' },
    measurement: { status: 'PENDING' },
    outcome: { status: 'PENDING' },
    tune: { status: 'PENDING' },
    ...overrides,
  }
}

describe('evaluateBusinessLoopClosure', () => {
  it('does not apply to an Issue without the impact-loop label', () => {
    expect(evaluateBusinessLoopClosure({ labels: ['bug'], comments: [] })).toEqual({ status: 'NOT_APPLICABLE' })
  })

  it('is incomplete when an impact-loop Issue has no receipt at all', () => {
    const result = evaluateBusinessLoopClosure({ labels: [IMPACT_LOOP_LABEL], comments: [] })
    expect(result.status).toBe('INCOMPLETE')
  })

  // Fixture #10: an execution-only receipt cannot close a business IMPACT Issue.
  it('is incomplete with an execution-only receipt', () => {
    const body = serializeOutcomeReceipt(receipt())
    const result = evaluateBusinessLoopClosure({ labels: [IMPACT_LOOP_LABEL], comments: [{ body }] })
    expect(result.status).toBe('INCOMPLETE')
  })

  // Fixture #10: a complete receipt with Check and Tune can close it.
  it('is complete with measurement, outcome and tune all DONE', () => {
    const body = serializeOutcomeReceipt(
      receipt({ measurement: { status: 'DONE' }, outcome: { status: 'DONE' }, tune: { status: 'DONE' } })
    )
    const result = evaluateBusinessLoopClosure({ labels: [IMPACT_LOOP_LABEL], comments: [{ body }] })
    expect(result.status).toBe('COMPLETE')
  })

  it('reads the latest receipt across multiple comments', () => {
    const first = serializeOutcomeReceipt(
      receipt({ measurement: { status: 'DONE' }, outcome: { status: 'DONE' }, tune: { status: 'DONE' } })
    )
    const second = serializeOutcomeReceipt(receipt())
    const result = evaluateBusinessLoopClosure({
      labels: [IMPACT_LOOP_LABEL],
      comments: [{ body: first }, { body: second }],
    })
    expect(result.status).toBe('INCOMPLETE')
  })
})
