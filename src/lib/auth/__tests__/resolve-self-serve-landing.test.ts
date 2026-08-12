/**
 * PR6 (docs/specs/2026-08-11-onboarding-integrations-unify-v1.md) —
 * resolveSelfServeLanding is the actual activation switch: it decides
 * whether a self-serve client lands on the new 5-step wizard or falls
 * through to wherever they were headed. No test existed for this function
 * before (only normalizeSelfServeTarget, a different helper in the same
 * file, was covered) — this is the core logic PR6 flips, so it needs its
 * own direct coverage now.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

import { resolveSelfServeLanding } from '../self-serve-routing'

const CLIENT_ID = '11111111-1111-1111-1111-111111111111'
const CLIENT_HOME = `/dashboard/clients/${CLIENT_ID}`

function mockClientRow(data: { onboarding_completed_at: string | null } | null) {
  mocks.from.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveSelfServeLanding — the PR6 activation switch', () => {
  it('a brand-new client (onboarding_completed_at null) lands on /onboarding, not the old /brief form', async () => {
    mockClientRow({ onboarding_completed_at: null })

    const result = await resolveSelfServeLanding(CLIENT_ID, CLIENT_HOME, false)

    expect(result).toBe(`${CLIENT_HOME}/onboarding`)
    expect(result).not.toContain('/brief')
  })

  it('a client who filled Step 1 (which sets brief_completed_at) but never finished the wizard is still sent back to /onboarding', async () => {
    // The old gate checked brief_completed_at — that would have let this
    // client straight through. The new gate checks onboarding_completed_at,
    // which is only set by the wizard's own final submit.
    mockClientRow({ onboarding_completed_at: null })

    const result = await resolveSelfServeLanding(CLIENT_ID, CLIENT_HOME, false)

    expect(result).toBe(`${CLIENT_HOME}/onboarding`)
  })

  it('a client who fully completed onboarding is NOT sent back to the wizard', async () => {
    mockClientRow({ onboarding_completed_at: '2026-08-11T00:00:00Z' })

    const result = await resolveSelfServeLanding(CLIENT_ID, CLIENT_HOME, false)

    expect(result).toBe(CLIENT_HOME)
    expect(result).not.toContain('/onboarding')
  })

  it('preserves the requested `next` path in the onboarding redirect for later resumption', async () => {
    mockClientRow({ onboarding_completed_at: null })

    const result = await resolveSelfServeLanding(CLIENT_ID, `${CLIENT_HOME}/execution`, false)

    expect(result).toContain('/onboarding')
    expect(result).toContain(`next=${encodeURIComponent(`${CLIENT_HOME}/execution`)}`)
  })

  it('carries the welcome=1 flag into the onboarding redirect', async () => {
    mockClientRow({ onboarding_completed_at: null })

    const result = await resolveSelfServeLanding(CLIENT_ID, CLIENT_HOME, true)

    expect(result).toContain('welcome=1')
  })

  it('appends ?welcome=1 to the client home (not onboarding) once onboarding is done and landing on own home', async () => {
    mockClientRow({ onboarding_completed_at: '2026-08-11T00:00:00Z' })

    const result = await resolveSelfServeLanding(CLIENT_ID, CLIENT_HOME, true)

    expect(result).toBe(`${CLIENT_HOME}?welcome=1`)
  })

  it('treats a missing client row the same as "not onboarded" — fails closed to the wizard, not open to the dashboard', async () => {
    mockClientRow(null)

    const result = await resolveSelfServeLanding(CLIENT_ID, CLIENT_HOME, false)

    expect(result).toBe(`${CLIENT_HOME}/onboarding`)
  })

  it('still normalises a foreign clientId in the requested path before deciding (path-traversal protection intact)', async () => {
    mockClientRow({ onboarding_completed_at: '2026-08-11T00:00:00Z' })
    const otherClientPath = '/dashboard/clients/22222222-2222-2222-2222-222222222222/execution'

    const result = await resolveSelfServeLanding(CLIENT_ID, otherClientPath, false)

    expect(result).toBe(`${CLIENT_HOME}/execution`)
  })
})
