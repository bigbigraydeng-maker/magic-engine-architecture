import { describe, expect, it } from 'vitest'
import {
  REQUIRED_FIELDS,
  findControlStateMarkers,
  missingRequiredFields,
  serializeControlState,
  validateControlState,
} from '../src/control-state.mjs'

function completePayload(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 'ME_CONTROL_STATE_V1',
    updated_at: '2026-08-29T12:00:00Z',
    summary: 'ok',
    current_p0: 'Issue #1225',
    portfolio_p0: [],
    product_capabilities: [],
    customer_loops: [],
    active_lanes: [],
    ray_needed: 'UNKNOWN',
    bottleneck: 'UNKNOWN',
    ...overrides,
  }
}

describe('serializeControlState / findControlStateMarkers round-trip', () => {
  it('round-trips a payload embedded in a longer comment', () => {
    const marker = serializeControlState(completePayload())
    const body = `Some prose.\n\n${marker}\n\nMore prose.`
    const found = findControlStateMarkers(body)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ schema_version: 'ME_CONTROL_STATE_V1' })
  })

  it('skips malformed JSON instead of throwing', () => {
    expect(findControlStateMarkers('<!-- ME_CONTROL_STATE_V1: {not json} -->')).toEqual([])
  })

  it('finds nothing in a comment with no marker', () => {
    expect(findControlStateMarkers('just a human comment')).toEqual([])
  })
})

describe('missingRequiredFields', () => {
  it('is empty for a complete payload', () => {
    expect(missingRequiredFields(completePayload())).toEqual([])
  })

  // Fixture #9: omission (key absent) fails; UNKNOWN value does not.
  it('flags only the truly absent keys, not ones holding "UNKNOWN"', () => {
    const payload = completePayload({ ray_needed: 'UNKNOWN', bottleneck: 'UNKNOWN' })
    expect(missingRequiredFields(payload)).toEqual([])
    const { current_p0: _drop, ...withoutCurrentP0 } = payload as Record<string, unknown>
    expect(missingRequiredFields(withoutCurrentP0)).toEqual(['current_p0'])
  })

  it('treats a non-object payload as missing every field', () => {
    expect(missingRequiredFields(null)).toEqual(REQUIRED_FIELDS)
    expect(missingRequiredFields('a string')).toEqual(REQUIRED_FIELDS)
    expect(missingRequiredFields([])).toEqual(REQUIRED_FIELDS)
  })
})

describe('validateControlState', () => {
  it('is valid when complete, parseable, and fresh', () => {
    const result = validateControlState({
      payload: completePayload({ updated_at: '2026-08-29T12:00:00Z' }),
      commentTimestamp: '2026-08-29T12:10:00Z',
    })
    expect(result.valid).toBe(true)
    expect(result.reasons).toEqual([])
  })

  // Fixture #8: an incomplete state fails even when its marker and JSON syntax are valid.
  it('fails on a structurally valid but incomplete payload', () => {
    const { bottleneck: _drop, ...incomplete } = completePayload() as Record<string, unknown>
    const result = validateControlState({ payload: incomplete, commentTimestamp: '2026-08-29T12:00:00Z' })
    expect(result.valid).toBe(false)
    expect(result.missingFields).toEqual(['bottleneck'])
  })

  it('does not let schema_version alone imply completeness', () => {
    // Same schema_version string, deliberately missing several fields — the
    // whole point is that this must not "silently mean complete".
    const partial = { schema_version: 'ME_CONTROL_STATE_V1', updated_at: '2026-08-29T12:00:00Z', summary: 'partial' }
    const result = validateControlState({ payload: partial, commentTimestamp: '2026-08-29T12:00:00Z' })
    expect(result.valid).toBe(false)
    expect(result.missingFields.length).toBeGreaterThan(0)
  })

  it('fails when updated_at does not parse', () => {
    const result = validateControlState({
      payload: completePayload({ updated_at: 'not-a-date' }),
      commentTimestamp: '2026-08-29T12:00:00Z',
    })
    expect(result.valid).toBe(false)
    expect(result.updatedAtParsed).toBe(false)
  })

  it('fails when updated_at is stale relative to the comment timestamp', () => {
    const result = validateControlState({
      payload: completePayload({ updated_at: '2026-08-01T00:00:00Z' }),
      commentTimestamp: '2026-08-29T12:00:00Z',
    })
    expect(result.valid).toBe(false)
    expect(result.fresh).toBe(false)
  })

  it('accepts a payload right at the freshness boundary', () => {
    const result = validateControlState({
      payload: completePayload({ updated_at: '2026-08-29T06:00:00Z' }),
      commentTimestamp: '2026-08-29T12:00:00Z',
      maxFreshnessMs: 6 * 60 * 60 * 1000,
    })
    expect(result.valid).toBe(true)
  })
})
