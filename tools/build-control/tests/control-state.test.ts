import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  CONTROL_STATE_MARKER,
  REQUIRED_FIELDS,
  findControlStateMarkers,
  missingRequiredFields,
  serializeControlState,
  validateControlState,
} from '../src/control-state.mjs'

const FIXTURE_PATH = join(process.cwd(), 'tools/build-control/tests/fixtures/control-state-real.md')
/** The live state file this fixture was copied from. Checked when present. */
const REAL_STATE_PATH = '/tmp/me-control-1140-recovery.md'

function completePayload(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: CONTROL_STATE_MARKER,
    updated_at: '2026-08-29T12:00:00Z',
    summary: 'one line of real state',
    current_p0: { issue: 1225, status: 'UNKNOWN' },
    portfolio_p0: { current_stage: 'recovery', outcome_status: 'NOT_PROVEN' },
    product_capabilities: [{ capability: 'Build Control', maturity: 'UNKNOWN' }],
    customer_loops: [{ loop: 'daily content', verified_outcome: 'UNKNOWN' }],
    active_lanes: [],
    ray_needed: [],
    bottleneck: 'worker version unproven',
    ...overrides,
  }
}

describe('the real Issue #1140 comment format', () => {
  it('parses the committed real-shape fixture as exactly one valid marker', () => {
    const body = readFileSync(FIXTURE_PATH, 'utf8')
    const markers = findControlStateMarkers(body)
    expect(markers).toHaveLength(1)

    const result = validateControlState({ payload: markers[0], commentTimestamp: '2026-08-29T14:10:00Z' })
    expect(result.reasons).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('rejects the inline-payload form the #1140 consumer cannot read', () => {
    const inline = `<!-- ${CONTROL_STATE_MARKER}: ${JSON.stringify(completePayload())} -->`
    expect(findControlStateMarkers(inline)).toEqual([])
  })

  it('round-trips the canonical standalone-marker + fenced-json shape', () => {
    const body = `prose above\n\n${serializeControlState(completePayload())}\n\nprose below`
    expect(body).toContain(`<!-- ${CONTROL_STATE_MARKER} -->`)
    expect(findControlStateMarkers(body)).toHaveLength(1)
  })

  it('skips a malformed JSON block instead of throwing', () => {
    expect(findControlStateMarkers(`<!-- ${CONTROL_STATE_MARKER} -->\n\`\`\`json\n{not json}\n\`\`\``)).toEqual([])
  })

  it('finds nothing in a comment with no marker', () => {
    expect(findControlStateMarkers('just a human comment')).toEqual([])
  })

  // Documentation-grade: proves the committed fixture still matches the live
  // file on a machine that has it. The fixture above is the actual lock.
  it.runIf(existsSync(REAL_STATE_PATH))('parses the live recovery state file as one marker', () => {
    expect(findControlStateMarkers(readFileSync(REAL_STATE_PATH, 'utf8'))).toHaveLength(1)
  })
})

describe('missingRequiredFields', () => {
  it('is empty for a complete payload', () => {
    expect(missingRequiredFields(completePayload())).toEqual([])
  })

  it('flags only truly absent keys', () => {
    const { current_p0: _drop, ...withoutCurrentP0 } = completePayload()
    expect(missingRequiredFields(withoutCurrentP0)).toEqual(['current_p0'])
  })

  it('treats a non-object payload as missing every field', () => {
    expect(missingRequiredFields(null)).toEqual(REQUIRED_FIELDS)
    expect(missingRequiredFields('a string')).toEqual(REQUIRED_FIELDS)
    expect(missingRequiredFields([])).toEqual(REQUIRED_FIELDS)
  })
})

describe('validateControlState', () => {
  const fresh = { commentTimestamp: '2026-08-29T12:10:00Z' }

  it('is valid when complete, well-typed, parseable and fresh', () => {
    const result = validateControlState({ payload: completePayload(), ...fresh })
    expect(result.reasons).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('rejects an all-null payload even though every key is present', () => {
    const allNull = Object.fromEntries(REQUIRED_FIELDS.map((f) => [f, null]))
    const result = validateControlState({ payload: allNull, ...fresh })
    expect(result.valid).toBe(false)
    expect(result.missingFields).toEqual([])
    expect(result.reasons.length).toBeGreaterThanOrEqual(REQUIRED_FIELDS.length)
  })

  it('does not let schema_version alone imply completeness', () => {
    const partial = { schema_version: CONTROL_STATE_MARKER, updated_at: '2026-08-29T12:00:00Z', summary: 'partial' }
    const result = validateControlState({ payload: partial, ...fresh })
    expect(result.valid).toBe(false)
    expect(result.missingFields.length).toBeGreaterThan(0)
  })

  it('rejects a wrong schema_version', () => {
    const result = validateControlState({ payload: completePayload({ schema_version: 'ME_CONTROL_STATE_V2' }), ...fresh })
    expect(result.valid).toBe(false)
    expect(result.reasons.some((r) => r.startsWith('schema_version'))).toBe(true)
  })

  it.each([
    ['summary', ''],
    ['bottleneck', '   '],
    ['current_p0', {}],
    ['portfolio_p0', 'UNKNOWN'],
    ['product_capabilities', []],
    ['customer_loops', 'UNKNOWN'],
    ['active_lanes', 'UNKNOWN'],
    ['ray_needed', 'UNKNOWN'],
  ])('rejects %s holding %j', (field, value) => {
    const result = validateControlState({ payload: completePayload({ [field]: value }), ...fresh })
    expect(result.valid).toBe(false)
    expect(result.reasons.some((r) => r.startsWith(field))).toBe(true)
  })

  it('keeps UNKNOWN legal inside otherwise well-typed fields', () => {
    const result = validateControlState({
      payload: completePayload({
        current_p0: { issue: 'UNKNOWN', next_gate: 'UNKNOWN' },
        customer_loops: [{ loop: 'daily content', verified_outcome: 'UNKNOWN' }],
      }),
      ...fresh,
    })
    expect(result.valid).toBe(true)
  })

  it('fails when updated_at does not parse', () => {
    const result = validateControlState({ payload: completePayload({ updated_at: 'not-a-date' }), ...fresh })
    expect(result.valid).toBe(false)
    expect(result.updatedAtParsed).toBe(false)
  })

  it('fails when updated_at is stale relative to the comment timestamp', () => {
    const result = validateControlState({ payload: completePayload({ updated_at: '2026-08-01T00:00:00Z' }), ...fresh })
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
