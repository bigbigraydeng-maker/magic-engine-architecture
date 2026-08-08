/**
 * Manual GSC attribution route — the user-visible half of Issue #859's
 * write-vs-reconciliation split.
 *
 * A post-write cleanup failure does not take the outcome rows back out of the
 * database, so this route must not answer "nothing landed" (502) for a run that
 * wrote three rows. But it must still fail loudly when the writes themselves
 * failed. `errors[]` holds both kinds, so `cleanup_errors` is what tells them
 * apart — these tests pin that distinction from the caller's side.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../route'

vi.mock('@/lib/flywheel/attribution/gsc-bridge', () => ({
  runGscAttributionForClient: vi.fn(),
}))

// The route's two guards are exercised by their own suites; these tests are
// about what the body and status say once a caller is through them.
vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/validation-utils', () => ({
  requireBearerToken: vi.fn(() => ({ ok: true })),
}))

import { runGscAttributionForClient } from '@/lib/flywheel/attribution/gsc-bridge'

const mockRun = vi.mocked(runGscAttributionForClient)

function makeRequest(body: unknown = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/clients/c1/flywheel/gsc-attribution', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
    body: JSON.stringify(body),
  })
}

const params = { id: 'c1' }

function result(over: Partial<Awaited<ReturnType<typeof runGscAttributionForClient>>> = {}) {
  return {
    client_id: 'c1',
    actions_found: 1,
    outcomes_written: 0,
    skipped: 0,
    cleanup_errors: 0,
    errors: [] as string[],
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/clients/[id]/flywheel/gsc-attribution', () => {
  it('reports success for a clean run', async () => {
    mockRun.mockResolvedValue(result({ outcomes_written: 3 }))

    const res = await POST(makeRequest(), { params })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.outcomes_written).toBe(3)
    expect(body.cleanup_errors).toBe(0)
  })

  it('does not claim "nothing landed" when only the cleanup failed', async () => {
    // The bug: 3 rows are in the database, and this used to answer 502 with
    // outcomes_written implicitly disowned.
    mockRun.mockResolvedValue(result({
      outcomes_written: 3,
      cleanup_errors: 1,
      errors: ['action a1: retire stale outcomes: deadlock'],
    }))

    const res = await POST(makeRequest(), { params })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true) // reconciliation debt, not a failed write
    expect(body.outcomes_written).toBe(3)
    expect(body.cleanup_errors).toBe(1)
    expect(body.errors).toHaveLength(1) // still reported, not hidden
  })

  it('fails loudly when the writes themselves failed and nothing landed', async () => {
    mockRun.mockResolvedValue(result({
      outcomes_written: 0,
      skipped: 1,
      cleanup_errors: 0,
      errors: ['action a1: upsert outcomes: connection reset'],
    }))

    const res = await POST(makeRequest(), { params })
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body.success).toBe(false)
  })

  it('does not report success when most writes failed but one landed', async () => {
    // `success` used to be "did anything at all land", so 9 failures and 1
    // success answered success:true.
    mockRun.mockResolvedValue(result({
      actions_found: 10,
      outcomes_written: 3,
      skipped: 9,
      cleanup_errors: 0,
      errors: Array.from({ length: 9 }, (_, i) => `action a${i}: upsert outcomes: boom`),
    }))

    const res = await POST(makeRequest(), { params })
    const body = await res.json()

    expect(body.success).toBe(false)
    expect(res.status).toBe(200) // rows did land, so not 502 — but not "success"
  })

  it('separates hard failures from cleanup debt when both happen', async () => {
    mockRun.mockResolvedValue(result({
      actions_found: 2,
      outcomes_written: 3,
      cleanup_errors: 1,
      errors: ['action a1: retire stale outcomes: x', 'action a2: upsert outcomes: y'],
    }))

    const res = await POST(makeRequest(), { params })
    const body = await res.json()

    expect(body.success).toBe(false) // one of the two is a real write failure
    expect(body.cleanup_errors).toBe(1)
    expect(body.errors).toHaveLength(2)
  })

  it('never answers 502 for a run whose only errors were reconciliation debt', async () => {
    // The bridge cannot currently produce written=0 alongside a cleanup error
    // (cleanup only runs after a successful upsert), but the contract is about
    // what the status means, not about which shapes happen to be reachable
    // today: a cleanup failure must never be the thing that makes this a 502.
    mockRun.mockResolvedValue(result({
      outcomes_written: 0,
      cleanup_errors: 1,
      errors: ['action a1: retire stale outcomes: deadlock'],
    }))

    const res = await POST(makeRequest(), { params })

    expect(res.status).toBe(200)
  })

  it('passes a valid window_days through and clamps an oversized one', async () => {
    mockRun.mockResolvedValue(result({ outcomes_written: 3 }))

    await POST(makeRequest({ window_days: 7 }), { params })
    expect(mockRun).toHaveBeenCalledWith('c1', 7)

    mockRun.mockClear()
    await POST(makeRequest({ window_days: 9999 }), { params })
    const [, clamped] = mockRun.mock.calls[0]
    expect(clamped).toBeLessThanOrEqual(90)
  })
})
