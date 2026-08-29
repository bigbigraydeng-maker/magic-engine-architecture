import { describe, expect, it } from 'vitest'
import { RECOVERY_OPEN_PR_CAP, evaluateCap } from '../src/pr-cap.mjs'

describe('evaluateCap', () => {
  it('never blocks a non-new-implementation event regardless of count', () => {
    // Fixture #6 (second half): a remediation comment on an existing PR must
    // not be misclassified as a new lane and blocked by the cap.
    const result = evaluateCap({ openPrCount: 999, isNewImplementation: false })
    expect(result.blocked).toBe(false)
  })

  it('allows a new implementation PR below the cap', () => {
    expect(evaluateCap({ openPrCount: RECOVERY_OPEN_PR_CAP - 1, isNewImplementation: true }).blocked).toBe(false)
  })

  // Fixture #6 (first half): a new PR above the cap is rejected.
  it('blocks a new implementation PR at or above the cap', () => {
    expect(evaluateCap({ openPrCount: RECOVERY_OPEN_PR_CAP, isNewImplementation: true }).blocked).toBe(true)
    expect(evaluateCap({ openPrCount: RECOVERY_OPEN_PR_CAP + 10, isNewImplementation: true }).blocked).toBe(true)
  })

  it('honours a valid narrow override', () => {
    const result = evaluateCap({
      openPrCount: RECOVERY_OPEN_PR_CAP,
      isNewImplementation: true,
      override: { grantedBy: 'owner', allowlist: ['owner'], reason: 'security incident, PM approved' },
    })
    expect(result.blocked).toBe(false)
  })

  it('rejects an override from someone not on the allowlist', () => {
    const result = evaluateCap({
      openPrCount: RECOVERY_OPEN_PR_CAP,
      isNewImplementation: true,
      override: { grantedBy: 'random-actor', allowlist: ['owner'], reason: 'trust me' },
    })
    expect(result.blocked).toBe(true)
  })

  it('rejects an override with no reason given', () => {
    const result = evaluateCap({
      openPrCount: RECOVERY_OPEN_PR_CAP,
      isNewImplementation: true,
      override: { grantedBy: 'owner', allowlist: ['owner'], reason: '' },
    })
    expect(result.blocked).toBe(true)
  })
})
