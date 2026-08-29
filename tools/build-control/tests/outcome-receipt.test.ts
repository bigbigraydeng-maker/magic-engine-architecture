import { describe, expect, it } from 'vitest'
import {
  isImpactComplete,
  selectTrustedOutcomeReceipts,
  serializeOutcomeReceipt,
  validateOutcomeReceiptShape,
} from '../src/outcome-receipt.mjs'

type Stage = { status: string; evidence?: string }

function receipt(overrides: Record<string, Stage | string> = {}) {
  return {
    recorded_by: 'owner',
    execution: { status: 'DONE', evidence: 'PR #1227 merged' },
    activation: { status: 'UNKNOWN' },
    measurement: { status: 'DONE', evidence: 'T+24 comparison recorded' },
    outcome: { status: 'DONE', evidence: 'classified NO_LIFT against baseline' },
    tune: { status: 'DONE', evidence: 'next decision: narrow the audience' },
    ...overrides,
  }
}

describe('validateOutcomeReceiptShape', () => {
  it('accepts a structurally complete receipt regardless of which statuses are DONE', () => {
    expect(validateOutcomeReceiptShape(receipt({ measurement: { status: 'PENDING' } })).valid).toBe(true)
  })

  it('rejects a receipt missing a stage', () => {
    const { tune: _drop, ...withoutTune } = receipt()
    const result = validateOutcomeReceiptShape(withoutTune)
    expect(result.valid).toBe(false)
    expect(result.reasons).toContain('missing stage: tune')
  })

  it('rejects an invalid status value', () => {
    expect(validateOutcomeReceiptShape(receipt({ outcome: { status: 'MAYBE' } })).valid).toBe(false)
  })
})

describe('isImpactComplete', () => {
  it('accepts Execution + Measurement + Outcome + Tune all DONE with evidence', () => {
    expect(isImpactComplete(receipt())).toEqual({ complete: true, reasons: [] })
  })

  it('does not require activation to be DONE — it may legitimately be UNKNOWN', () => {
    expect(isImpactComplete(receipt({ activation: { status: 'UNKNOWN' } })).complete).toBe(true)
  })

  it.each(['execution', 'measurement', 'outcome', 'tune'])('rejects a receipt whose %s is PENDING', (stage) => {
    const result = isImpactComplete(receipt({ [stage]: { status: 'PENDING' } }))
    expect(result.complete).toBe(false)
    expect(result.reasons.some((r) => r.includes(stage))).toBe(true)
  })

  // Engineering landing is necessary, never sufficient — and an unproven
  // execution cannot stand in for a proven one either.
  it('rejects an execution-only receipt', () => {
    const result = isImpactComplete(
      receipt({ measurement: { status: 'PENDING' }, outcome: { status: 'PENDING' }, tune: { status: 'PENDING' } })
    )
    expect(result.complete).toBe(false)
    expect(result.reasons).toHaveLength(3)
  })

  it('rejects an execution stage left UNKNOWN', () => {
    expect(isImpactComplete(receipt({ execution: { status: 'UNKNOWN' } })).complete).toBe(false)
  })

  it.each([['', 'empty'], ['   ', 'blank']])('rejects a DONE stage whose evidence is %j (%s)', (evidence) => {
    const result = isImpactComplete(receipt({ outcome: { status: 'DONE', evidence } }))
    expect(result.complete).toBe(false)
    expect(result.reasons.some((r) => r.includes('not proof'))).toBe(true)
  })

  it('rejects a DONE stage with no evidence field at all', () => {
    expect(isImpactComplete(receipt({ tune: { status: 'DONE' } })).complete).toBe(false)
  })

  it('rejects a structurally invalid payload before checking completion', () => {
    expect(isImpactComplete({ execution: { status: 'DONE' } }).complete).toBe(false)
  })
})

describe('selectTrustedOutcomeReceipts', () => {
  const body = (payload: unknown) => `closing this out\n\n${serializeOutcomeReceipt(payload)}`

  it('accepts a receipt from an allow-listed author who declares themselves', () => {
    const result = selectTrustedOutcomeReceipts({
      comments: [{ author: 'owner', body: body(receipt()) }],
      allowlist: ['owner'],
    })
    expect(result.trusted).toHaveLength(1)
  })

  // A random commenter cannot close an impact-loop Issue.
  it('rejects a receipt from an author who is not allow-listed', () => {
    const result = selectTrustedOutcomeReceipts({
      comments: [{ author: 'drive-by', body: body(receipt({ recorded_by: 'drive-by' })) }],
      allowlist: ['owner'],
    })
    expect(result.trusted).toEqual([])
    expect(result.rejected[0]).toContain('drive-by')
  })

  it('rejects a receipt whose recorded_by disagrees with the comment author', () => {
    const result = selectTrustedOutcomeReceipts({
      comments: [{ author: 'owner', body: body(receipt({ recorded_by: 'someone-else' })) }],
      allowlist: ['owner', 'someone-else'],
    })
    expect(result.trusted).toEqual([])
  })

  it('rejects a receipt that names nobody at all', () => {
    const { recorded_by: _drop, ...anonymous } = receipt()
    const result = selectTrustedOutcomeReceipts({
      comments: [{ author: 'owner', body: body(anonymous) }],
      allowlist: ['owner'],
    })
    expect(result.trusted).toEqual([])
  })

  it('skips malformed JSON', () => {
    const result = selectTrustedOutcomeReceipts({
      comments: [{ author: 'owner', body: '<!-- ME_OUTCOME_RECEIPT_V1: {broken -->' }],
      allowlist: ['owner'],
    })
    expect(result.trusted).toEqual([])
  })
})
