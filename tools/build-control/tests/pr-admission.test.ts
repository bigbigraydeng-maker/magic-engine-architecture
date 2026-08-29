import { describe, expect, it } from 'vitest'
import { evaluateAdmission } from '../src/pr-admission.mjs'
import { CUTOVER_ISO } from '../src/legacy-cutover.mjs'

const OUTCOME_CONTRACT = ['## Outcome-Contract', '- Proof: UNKNOWN', '- Verification-Window: UNKNOWN', '- Owner: UNKNOWN', '- Status: UNKNOWN'].join('\n')

function compliantBody(issue: number) {
  return `Primary-Issue: #${issue}\n\n${OUTCOME_CONTRACT}`
}

describe('evaluateAdmission', () => {
  it('passes a fully compliant, post-cutover PR', () => {
    const pr = { number: 1, body: compliantBody(1249), createdAt: '2026-09-01T00:00:00Z' }
    const result = evaluateAdmission({ pr, openPullRequests: [pr] })
    expect(result.grade).toBe('PASS')
    expect(result.reasons).toEqual([])
  })

  it('fails a post-cutover PR missing Primary-Issue and Outcome-Contract', () => {
    const pr = { number: 1, body: 'nothing here', createdAt: '2026-09-01T00:00:00Z' }
    const result = evaluateAdmission({ pr, openPullRequests: [pr] })
    expect(result.grade).toBe('FAIL')
    expect(result.reasons.length).toBeGreaterThanOrEqual(2)
  })

  // Fixture #5: legacy pre-cutover PRs pass with a truthful grandfather/triage result.
  it('grandfathers a pre-cutover PR with the same missing fields', () => {
    const pr = { number: 1, body: 'nothing here', createdAt: '2026-08-01T00:00:00Z' }
    const result = evaluateAdmission({ pr, openPullRequests: [pr] })
    expect(result.grade).toBe('LEGACY_TRIAGE_REQUIRED')
    expect(result.reasons.length).toBeGreaterThan(0)
    expect(new Date(pr.createdAt).getTime()).toBeLessThan(Date.parse(CUTOVER_ISO))
  })

  it('fails when another open PR already claims the same Primary-Issue', () => {
    const pr = { number: 2, body: compliantBody(1249), createdAt: '2026-09-01T00:00:00Z' }
    const other = { number: 1, body: 'Primary-Issue: #1249', createdAt: '2026-08-01T00:00:00Z' }
    const result = evaluateAdmission({ pr, openPullRequests: [pr, other] })
    expect(result.grade).toBe('FAIL')
    expect(result.reasons.some((r) => r.includes('#1'))).toBe(true)
  })

  it('does not flag itself as a duplicate of its own Primary-Issue claim', () => {
    const pr = { number: 1, body: compliantBody(1249), createdAt: '2026-09-01T00:00:00Z' }
    const result = evaluateAdmission({ pr, openPullRequests: [pr] })
    expect(result.checks.duplicate.claimed).toBe(false)
  })

  it('fails a new PR opened while the repository is above the recovery cap', () => {
    const pr = { number: 1, body: compliantBody(1249), createdAt: '2026-09-01T00:00:00Z' }
    const openPullRequests = [pr, ...Array.from({ length: 12 }, (_, i) => ({ number: 100 + i, body: '' }))]
    const result = evaluateAdmission({ pr, openPullRequests })
    expect(result.grade).toBe('FAIL')
    expect(result.checks.cap.blocked).toBe(true)
  })
})
