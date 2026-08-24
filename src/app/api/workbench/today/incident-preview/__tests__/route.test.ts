/**
 * GET /api/workbench/today/incident-preview (#1169 WP3)
 */

import { describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({ guardAdmin: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ guardAdmin: mocks.guardAdmin }))

import { GET } from '../route'

describe('GET /api/workbench/today/incident-preview', () => {
  it('rejects a non-admin caller via the same guardAdmin gate as the rest of the preview route family', async () => {
    mocks.guardAdmin.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))

    const res = await GET()

    expect(res.status).toBe(403)
  })

  it('honestly labels itself as a frozen, non-live fixture', async () => {
    mocks.guardAdmin.mockResolvedValue(null)

    const json = await (await GET()).json()

    expect(json.live).toBe(false)
    expect(json.fixture).toContain('audited-77')
    expect(json.fixture.toLowerCase()).toMatch(/frozen|not live/)
  })

  it('accounts for all 77 raw occurrences and every incident is honestly RECOVERY_UNKNOWN', async () => {
    mocks.guardAdmin.mockResolvedValue(null)

    const json = await (await GET()).json()

    expect(json.totalRawOccurrences).toBe(77)
    expect(json.totalAccountedOccurrences).toBe(77)
    expect(json.incidents.every((i: { status: string }) => i.status === 'RECOVERY_UNKNOWN')).toBe(true)
    // No retry/fix/notify action fields on this preview-only payload.
    expect(json.retry).toBeUndefined()
    expect(json.fix).toBeUndefined()
  })

  // B1 (Build Control remediation) — the JSON payload itself, not just the
  // client rendering, must already carry PM-readable Chinese text.
  it('the raw API payload — not just client rendering — already carries PM-readable Chinese incident text', async () => {
    mocks.guardAdmin.mockResolvedValue(null)

    const json = await (await GET()).json()
    const CJK = /[一-鿿]/

    expect(json.incidents.length).toBeGreaterThan(0)
    for (const incident of json.incidents as Array<{ rootCause: string; affectedScope: string }>) {
      expect(incident.rootCause).toMatch(CJK)
      expect(incident.affectedScope).toMatch(CJK)
    }
  })
})
