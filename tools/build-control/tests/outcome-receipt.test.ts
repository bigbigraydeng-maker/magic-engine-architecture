import { describe, expect, it } from 'vitest'
import {
  findOutcomeReceiptMarkers,
  isImpactComplete,
  serializeOutcomeReceipt,
  validateOutcomeReceiptShape,
} from '../src/outcome-receipt.mjs'

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

describe('validateOutcomeReceiptShape', () => {
  it('accepts a structurally complete receipt regardless of which statuses are DONE', () => {
    expect(validateOutcomeReceiptShape(receipt()).valid).toBe(true)
  })

  it('rejects a receipt missing a stage', () => {
    const { tune: _drop, ...withoutTune } = receipt()
    const result = validateOutcomeReceiptShape(withoutTune)
    expect(result.valid).toBe(false)
    expect(result.reasons).toContain('missing stage: tune')
  })

  it('rejects an invalid status value', () => {
    const result = validateOutcomeReceiptShape(receipt({ outcome: { status: 'MAYBE' } }))
    expect(result.valid).toBe(false)
  })
})

describe('isImpactComplete', () => {
  // Fixture #10: an execution-only receipt cannot close a business IMPACT Issue.
  it('rejects an execution-only receipt', () => {
    const result = isImpactComplete(receipt())
    expect(result.complete).toBe(false)
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  // Fixture #10: a complete receipt with Check (measurement) and Tune (plus outcome) can close it.
  it('accepts a receipt with measurement, outcome and tune all DONE', () => {
    const result = isImpactComplete(
      receipt({ measurement: { status: 'DONE' }, outcome: { status: 'DONE' }, tune: { status: 'DONE' } })
    )
    expect(result).toEqual({ complete: true, reasons: [] })
  })

  it('rejects when only measurement and tune are DONE but outcome classification is missing DONE', () => {
    const result = isImpactComplete(receipt({ measurement: { status: 'DONE' }, tune: { status: 'DONE' } }))
    expect(result.complete).toBe(false)
  })

  it('does not require activation to be DONE — it may legitimately be UNKNOWN', () => {
    const result = isImpactComplete(
      receipt({
        activation: { status: 'UNKNOWN' },
        measurement: { status: 'DONE' },
        outcome: { status: 'DONE' },
        tune: { status: 'DONE' },
      })
    )
    expect(result.complete).toBe(true)
  })

  it('rejects a structurally invalid payload before even checking completion', () => {
    expect(isImpactComplete({ execution: { status: 'DONE' } }).complete).toBe(false)
  })
})

describe('serializeOutcomeReceipt / findOutcomeReceiptMarkers round-trip', () => {
  it('round-trips through a comment body', () => {
    const marker = serializeOutcomeReceipt(receipt())
    const found = findOutcomeReceiptMarkers(`prose\n${marker}\nmore prose`)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ execution: { status: 'DONE' } })
  })

  it('skips malformed JSON', () => {
    expect(findOutcomeReceiptMarkers('<!-- ME_OUTCOME_RECEIPT_V1: {broken -->')).toEqual([])
  })
})
