import { describe, expect, it } from 'vitest'
import { evaluateAdmission } from '../src/pr-admission.mjs'
import { CUTOVER_ISO } from '../src/legacy-cutover.mjs'
import { RECOVERY_OPEN_PR_CAP } from '../src/pr-cap.mjs'

const OUTCOME_CONTRACT = [
  '## Outcome-Contract',
  '- Proof: UNKNOWN',
  '- Verification-Window: UNKNOWN',
  '- Owner: UNKNOWN',
  '- Status: UNKNOWN',
].join('\n')

const compliantBody = (issue: number) => `Primary-Issue: #${issue}\n\n${OUTCOME_CONTRACT}`
const POST_CUTOVER = '2026-09-01T00:00:00Z'

/** Filler open PRs that declare nothing, so only the cap is exercised. */
const filler = (count: number) => Array.from({ length: count }, (_unused, i) => ({ number: 100 + i, body: '' }))

const override = {
  primary_issue: 1249,
  granted_by: 'owner',
  reason: 'recovery control-plane',
  expires_at: '2026-08-30T00:00:00Z',
}

describe('evaluateAdmission', () => {
  it('passes a fully compliant, post-cutover PR', () => {
    const pr = { number: 1, body: compliantBody(1249), createdAt: POST_CUTOVER }
    const result = evaluateAdmission({ pr, openPullRequests: [pr] })
    expect(result.reasons).toEqual([])
    expect(result.grade).toBe('PASS')
  })

  it('fails a post-cutover PR missing Primary-Issue and Outcome-Contract', () => {
    const pr = { number: 1, body: 'nothing here', createdAt: POST_CUTOVER }
    const result = evaluateAdmission({ pr, openPullRequests: [pr] })
    expect(result.grade).toBe('FAIL')
    expect(result.reasons.length).toBeGreaterThanOrEqual(2)
  })

  it('fails a PR that declares the same Primary-Issue twice', () => {
    const body = `Primary-Issue: #1249\n${OUTCOME_CONTRACT}\n\nPrimary-Issue: #1249`
    const pr = { number: 1, body, createdAt: POST_CUTOVER }
    const result = evaluateAdmission({ pr, openPullRequests: [pr] })
    expect(result.grade).toBe('FAIL')
    expect(result.reasons.some((r) => r.includes('more than once'))).toBe(true)
  })

  it('grandfathers a pre-cutover PR with the same missing fields', () => {
    const pr = { number: 1, body: 'nothing here', createdAt: '2026-08-01T00:00:00Z' }
    const result = evaluateAdmission({ pr, openPullRequests: [pr] })
    expect(result.grade).toBe('LEGACY_TRIAGE_REQUIRED')
    expect(Date.parse(pr.createdAt)).toBeLessThan(Date.parse(CUTOVER_ISO))
  })

  it('fails when another open PR already claims the same Primary-Issue', () => {
    const pr = { number: 2, body: compliantBody(1249), createdAt: POST_CUTOVER }
    const other = { number: 1, body: 'Primary-Issue: #1249' }
    const result = evaluateAdmission({ pr, openPullRequests: [pr, other] })
    expect(result.grade).toBe('FAIL')
    expect(result.reasons.some((r) => r.includes('#1'))).toBe(true)
  })

  it('does not flag itself as a duplicate of its own Primary-Issue claim', () => {
    const pr = { number: 1, body: compliantBody(1249), createdAt: POST_CUTOVER }
    expect(evaluateAdmission({ pr, openPullRequests: [pr] }).checks.duplicate.claimed).toBe(false)
  })

  // The PR being admitted is already open by the time this runs; counting it
  // would make the cap block the very PR that fills the last permitted slot.
  it('admits the twelfth open PR — the current PR is excluded from the count', () => {
    const pr = { number: 1, body: compliantBody(1249), createdAt: POST_CUTOVER }
    const openPullRequests = [pr, ...filler(RECOVERY_OPEN_PR_CAP - 1)]
    expect(openPullRequests).toHaveLength(RECOVERY_OPEN_PR_CAP)
    const result = evaluateAdmission({ pr, openPullRequests })
    expect(result.checks.cap.blocked).toBe(false)
    expect(result.grade).toBe('PASS')
  })

  it('blocks the thirteenth open PR', () => {
    const pr = { number: 1, body: compliantBody(1249), createdAt: POST_CUTOVER }
    const openPullRequests = [pr, ...filler(RECOVERY_OPEN_PR_CAP)]
    const result = evaluateAdmission({ pr, openPullRequests })
    expect(result.checks.cap.blocked).toBe(true)
    expect(result.grade).toBe('FAIL')
  })

  it('lets a verified override past the cap', () => {
    const pr = { number: 1, body: compliantBody(1249), createdAt: POST_CUTOVER }
    const openPullRequests = [pr, ...filler(RECOVERY_OPEN_PR_CAP)]
    const result = evaluateAdmission({ pr, openPullRequests, capOverride: override })
    expect(result.checks.cap.blocked).toBe(false)
    expect(result.grade).toBe('PASS')
  })

  it('never lets an override past a duplicate or a missing contract', () => {
    const pr = { number: 2, body: 'Primary-Issue: #1249', createdAt: POST_CUTOVER }
    const other = { number: 1, body: 'Primary-Issue: #1249' }
    const result = evaluateAdmission({
      pr,
      openPullRequests: [pr, other, ...filler(RECOVERY_OPEN_PR_CAP)],
      capOverride: override,
    })
    expect(result.grade).toBe('FAIL')
    expect(result.checks.cap.blocked).toBe(false)
    expect(result.checks.duplicate.claimed).toBe(true)
    expect(result.reasons.some((r) => r.includes('Outcome-Contract'))).toBe(true)
  })
})
