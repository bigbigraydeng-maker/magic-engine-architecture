import { describe, expect, it } from 'vitest'
import { RECOVERY_OPEN_PR_CAP, evaluateCap } from '../src/pr-cap.mjs'

const override = {
  primary_issue: 1249,
  granted_by: 'owner',
  reason: 'security incident',
  expires_at: '2026-08-30T00:00:00Z',
}

describe('evaluateCap', () => {
  it('never blocks a non-new-implementation event regardless of count', () => {
    // A remediation comment on an existing PR must not be misclassified as a
    // new lane and blocked by the backlog it is there to fix.
    expect(evaluateCap({ openPrCount: 999, isNewImplementation: false }).blocked).toBe(false)
  })

  // Cap semantics: openPrCount excludes the lane being judged, so a cap of 12
  // permits the twelfth open PR and blocks the thirteenth.
  it('permits the twelfth open PR', () => {
    expect(evaluateCap({ openPrCount: RECOVERY_OPEN_PR_CAP - 1, isNewImplementation: true }).blocked).toBe(false)
  })

  it('blocks the thirteenth open PR', () => {
    expect(evaluateCap({ openPrCount: RECOVERY_OPEN_PR_CAP, isNewImplementation: true }).blocked).toBe(true)
    expect(evaluateCap({ openPrCount: RECOVERY_OPEN_PR_CAP + 10, isNewImplementation: true }).blocked).toBe(true)
  })

  it('lets a verified override through the cap', () => {
    const result = evaluateCap({ openPrCount: RECOVERY_OPEN_PR_CAP, isNewImplementation: true, override })
    expect(result.blocked).toBe(false)
    expect(result.reason).toContain('owner')
  })

  it('blocks when no override is presented', () => {
    expect(evaluateCap({ openPrCount: RECOVERY_OPEN_PR_CAP, isNewImplementation: true, override: null }).blocked).toBe(
      true
    )
  })
})
