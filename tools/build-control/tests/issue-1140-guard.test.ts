import { describe, expect, it } from 'vitest'
import { CONTROL_STATE_MARKER, serializeControlState } from '../src/control-state.mjs'
import { evaluateControlStateGuard } from '../src/issue-1140-guard.mjs'

function completePayload(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: CONTROL_STATE_MARKER,
    updated_at: '2026-08-29T12:00:00Z',
    summary: 'one line of real state',
    current_p0: { issue: 1225, status: 'UNKNOWN' },
    portfolio_p0: { current_stage: 'recovery' },
    product_capabilities: [{ capability: 'Build Control' }],
    customer_loops: [{ loop: 'daily content' }],
    active_lanes: [],
    ray_needed: [],
    bottleneck: 'worker version unproven',
    ...overrides,
  }
}

const at = '2026-08-29T12:05:00Z'
const comment = (author: string, payload: unknown, createdAt = at) => ({
  author,
  body: serializeControlState(payload),
  createdAt,
})
const writerAllowlist = ['state-writer']

describe('evaluateControlStateGuard', () => {
  it('reports NO_MARKER when nothing carries the marker', () => {
    expect(
      evaluateControlStateGuard({
        comments: [{ author: 'state-writer', body: 'just a comment', createdAt: at }],
        writerAllowlist,
      })
    ).toEqual({ status: 'NO_MARKER' })
  })

  it('validates a complete, fresh marker from an allow-listed writer', () => {
    const result = evaluateControlStateGuard({ comments: [comment('state-writer', completePayload())], writerAllowlist })
    expect(result.status).toBe('VALID')
  })

  it('flags an incomplete marker as INVALID even though the JSON is well-formed', () => {
    const { bottleneck: _drop, ...incomplete } = completePayload()
    const result = evaluateControlStateGuard({ comments: [comment('state-writer', incomplete)], writerAllowlist })
    expect(result.status).toBe('INVALID')
    expect(result.status === 'INVALID' && result.reasons.some((r) => r.includes('bottleneck'))).toBe(true)
  })

  // The newest marked comment is the one downstream would read, so an
  // untrusted one must be reported, not quietly skipped past to an older
  // trusted snapshot that no longer reflects what the Issue shows.
  it('never reports an untrusted latest marker as canonical', () => {
    const result = evaluateControlStateGuard({
      comments: [
        comment('state-writer', completePayload(), '2026-08-29T10:00:00Z'),
        comment('drive-by', completePayload(), '2026-08-29T12:00:00Z'),
      ],
      writerAllowlist,
    })
    expect(result.status).toBe('UNTRUSTED')
    expect(result.status === 'UNTRUSTED' && result.reasons[0]).toContain('drive-by')
  })

  it('treats an unattributed comment as untrusted', () => {
    const result = evaluateControlStateGuard({
      comments: [{ author: null, body: serializeControlState(completePayload()), createdAt: at }],
      writerAllowlist,
    })
    expect(result.status).toBe('UNTRUSTED')
  })

  it('reads the latest trusted marker when several comments carry one', () => {
    const { current_p0: _drop, ...newerIncomplete } = completePayload()
    const result = evaluateControlStateGuard({
      comments: [
        comment('state-writer', completePayload(), '2026-08-29T10:00:00Z'),
        comment('state-writer', newerIncomplete, '2026-08-29T12:00:00Z'),
      ],
      writerAllowlist,
    })
    expect(result.status).toBe('INVALID')
  })
})
