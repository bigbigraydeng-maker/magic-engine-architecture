import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../route'

vi.mock('@/lib/flywheel/attribution/job', () => ({
  runAttributionJob: vi.fn(),
  // Mirrors the real export; the route needs it to derive the pass-1 window it
  // forwards to pass 2. NOTE: the forwarding assertions below exercise THIS
  // mocked constant, so they cannot detect drift from the real module — the
  // real export is pinned, unmocked, in window-handoff.test.ts ("the real
  // DEFAULT_WINDOW_DAYS export is 14").
  DEFAULT_WINDOW_DAYS: 14,
}))

vi.mock('@/lib/flywheel/attribution/gsc-bridge', () => ({
  runGscAttributionForClient: vi.fn(),
}))

import { runAttributionJob } from '@/lib/flywheel/attribution/job'
import { runGscAttributionForClient } from '@/lib/flywheel/attribution/gsc-bridge'

const mockRunAttributionJob = vi.mocked(runAttributionJob)
const mockRunGscAttribution = vi.mocked(runGscAttributionForClient)

function makeRequest(
  headers: Record<string, string> = {},
  search = ''
): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/cron/attribution${search}`,
    { method: 'POST', headers }
  )
}

describe('POST /api/cron/attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-secret'
    mockRunGscAttribution.mockResolvedValue({
      client_id: 'abc-123',
      actions_found: 0,
      outcomes_written: 0,
      skipped: 0,
      errors: [],
    })
  })

  // ── Auth ────────────────────────────────────────────────────────────────────

  it('returns 500 when CRON_SECRET env var is not set', async () => {
    delete process.env.CRON_SECRET
    const res = await POST(makeRequest({ authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/CRON_SECRET/)
  })

  it('returns 401 when Authorization header is missing', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 401 when Authorization header is wrong', async () => {
    const res = await POST(makeRequest({ authorization: 'Bearer wrong' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('calls runAttributionJob with default options and returns result', async () => {
    mockRunAttributionJob.mockResolvedValue({ processed: 5, written: 3, skipped: 2, deferred: 0 })

    const res = await POST(makeRequest({ authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.processed).toBe(5)
    expect(body.written).toBe(3)
    expect(body.skipped).toBe(2)
    expect(body.timestamp).toBeDefined()

    expect(mockRunAttributionJob).toHaveBeenCalledWith({
      windowDays: undefined,
      clientId: undefined,
    })
  })

  it('surfaces actions deferred to another evaluator in the response', async () => {
    // Deferrals are normal routing, not failures — but they still have to be
    // visible, otherwise "pass 1 wrote nothing today" looks like a gap.
    mockRunAttributionJob.mockResolvedValue({ processed: 9, written: 4, skipped: 1, deferred: 4 })

    const res = await POST(makeRequest({ authorization: 'Bearer test-secret' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.deferred).toBe(4)
  })

  it('passes window_days query param to runAttributionJob', async () => {
    mockRunAttributionJob.mockResolvedValue({ processed: 2, written: 2, skipped: 0, deferred: 0 })

    const res = await POST(
      makeRequest({ authorization: 'Bearer test-secret' }, '?window_days=30')
    )
    expect(res.status).toBe(200)
    expect(mockRunAttributionJob).toHaveBeenCalledWith({
      windowDays: 30,
      clientId: undefined,
    })
  })

  it('passes client_id query param to runAttributionJob', async () => {
    mockRunAttributionJob.mockResolvedValue({ processed: 1, written: 1, skipped: 0, deferred: 0 })

    const res = await POST(
      makeRequest(
        { authorization: 'Bearer test-secret' },
        '?client_id=abc-123'
      )
    )
    expect(res.status).toBe(200)
    expect(mockRunAttributionJob).toHaveBeenCalledWith({
      windowDays: undefined,
      clientId: 'abc-123',
    })
  })

  // ── Pass 1 → Pass 2 window forwarding (Issue #859, Codex P2) ───────────────
  //
  // Pass 1 defers seo.gsc.* actions to the bridge, so the window pass 1 ran at
  // must ride along — otherwise the deferred actions' answer at that window is
  // produced by nobody. client_id pins the pass-2 client list so the loop runs
  // deterministically without touching the connectors table.

  it('forwards the default pass-1 window (14) to the GSC bridge', async () => {
    mockRunAttributionJob.mockResolvedValue({ processed: 1, written: 0, skipped: 0, deferred: 1 })

    const res = await POST(
      makeRequest({ authorization: 'Bearer test-secret' }, '?client_id=abc-123')
    )

    expect(res.status).toBe(200)
    expect(mockRunGscAttribution).toHaveBeenCalledWith('abc-123', undefined, {
      deferredWindowDays: 14,
    })
  })

  it('forwards an explicit ?window_days=7 to the GSC bridge', async () => {
    mockRunAttributionJob.mockResolvedValue({ processed: 1, written: 0, skipped: 0, deferred: 1 })

    const res = await POST(
      makeRequest({ authorization: 'Bearer test-secret' }, '?window_days=7&client_id=abc-123')
    )

    expect(res.status).toBe(200)
    expect(mockRunGscAttribution).toHaveBeenCalledWith('abc-123', undefined, {
      deferredWindowDays: 7,
    })
  })

  it.each([
    ['abc', 'non-numeric'],
    ['-7', 'negative'],
    ['0', 'zero'],
  ])('sanitises ?window_days=%s (%s) to the default before forwarding', async (raw) => {
    // parseInt garbage yields NaN, which `??` does not catch; forwarded raw it
    // would defeat the bridge's dedupe guard and error every deferred action.
    // Pass 1 keeps main's behaviour for the same input — only the forwarding
    // is sanitised.
    mockRunAttributionJob.mockResolvedValue({ processed: 0, written: 0, skipped: 0, deferred: 0 })

    const res = await POST(
      makeRequest({ authorization: 'Bearer test-secret' }, `?window_days=${raw}&client_id=abc-123`)
    )

    expect(res.status).toBe(200)
    expect(mockRunGscAttribution).toHaveBeenCalledWith('abc-123', undefined, {
      deferredWindowDays: 14,
    })
  })

  it('leaves the bridge cadence window to the bridge (never overrides it)', async () => {
    mockRunAttributionJob.mockResolvedValue({ processed: 1, written: 0, skipped: 0, deferred: 1 })

    await POST(
      makeRequest({ authorization: 'Bearer test-secret' }, '?window_days=7&client_id=abc-123')
    )

    // Second positional arg stays undefined: pass 1's window changes what the
    // bridge computes IN ADDITION, not what its own 28-day cadence runs at.
    const [, cadenceWindow] = mockRunGscAttribution.mock.calls[0]
    expect(cadenceWindow).toBeUndefined()
  })

  // ── Error handling ──────────────────────────────────────────────────────────

  it('returns 500 when runAttributionJob throws', async () => {
    mockRunAttributionJob.mockRejectedValue(new Error('DB connection failed'))

    const res = await POST(makeRequest({ authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('DB connection failed')
  })
})
