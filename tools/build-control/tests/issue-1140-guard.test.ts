import { describe, expect, it } from 'vitest'
import { evaluateControlStateGuard } from '../src/issue-1140-guard.mjs'
import { serializeControlState } from '../src/control-state.mjs'

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

describe('evaluateControlStateGuard', () => {
  it('reports NO_MARKER when nothing carries the marker', () => {
    expect(evaluateControlStateGuard({ comments: [{ body: 'just a comment', createdAt: '2026-08-29T12:00:00Z' }] })).toEqual({
      status: 'NO_MARKER',
    })
  })

  it('validates a complete, fresh marker', () => {
    const body = serializeControlState(completePayload())
    const result = evaluateControlStateGuard({ comments: [{ body, createdAt: '2026-08-29T12:05:00Z' }] })
    expect(result.status).toBe('VALID')
  })

  // Fixture #8: an incomplete #1140 state fails even when its marker and JSON syntax are valid.
  it('flags an incomplete marker as INVALID even though the JSON is well-formed', () => {
    const { bottleneck: _drop, ...incomplete } = completePayload()
    const body = serializeControlState(incomplete)
    const result = evaluateControlStateGuard({ comments: [{ body, createdAt: '2026-08-29T12:05:00Z' }] })
    expect(result.status).toBe('INVALID')
    if (result.status === 'INVALID') {
      expect(result.reasons.some((r) => r.includes('bottleneck'))).toBe(true)
    }
  })

  it('reads the latest marker when several comments carry one', () => {
    const older = serializeControlState(completePayload({ summary: 'stale' }))
    const { current_p0: _drop, ...newerIncomplete } = completePayload({ summary: 'fresh' })
    const newer = serializeControlState(newerIncomplete)
    const result = evaluateControlStateGuard({
      comments: [
        { body: older, createdAt: '2026-08-29T10:00:00Z' },
        { body: newer, createdAt: '2026-08-29T12:00:00Z' },
      ],
    })
    expect(result.status).toBe('INVALID')
  })
})
