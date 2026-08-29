import { describe, expect, it } from 'vitest'
import { evaluateDispatchPreflight } from '../src/dispatch-preflight.mjs'
import { RECOVERY_OPEN_PR_CAP } from '../src/pr-cap.mjs'

describe('evaluateDispatchPreflight', () => {
  it('does not apply to a non-new-implementation trigger (PR review/remediation comment)', () => {
    const result = evaluateDispatchPreflight({
      isNewImplementationDispatch: false,
      issueNumber: 1009,
      openPullRequests: Array.from({ length: 999 }, (_, i) => ({ number: i, body: '' })),
    })
    expect(result.blocked).toBe(false)
  })

  it('fails closed when the issue number could not be determined', () => {
    const result = evaluateDispatchPreflight({ isNewImplementationDispatch: true, issueNumber: null, openPullRequests: [] })
    expect(result.blocked).toBe(true)
  })

  it('blocks when another open PR already declares this Primary-Issue', () => {
    const result = evaluateDispatchPreflight({
      isNewImplementationDispatch: true,
      issueNumber: 1009,
      openPullRequests: [{ number: 1007, body: 'Primary-Issue: #1009' }],
    })
    expect(result.blocked).toBe(true)
    expect(result.reasons[0]).toContain('#1007')
  })

  it('blocks when the repository is at the recovery cap', () => {
    const openPullRequests = Array.from({ length: RECOVERY_OPEN_PR_CAP }, (_, i) => ({ number: i, body: '' }))
    const result = evaluateDispatchPreflight({ isNewImplementationDispatch: true, issueNumber: 5000, openPullRequests })
    expect(result.blocked).toBe(true)
  })

  it('blocks when a lane is already active for this exact issue', () => {
    const result = evaluateDispatchPreflight({
      isNewImplementationDispatch: true,
      issueNumber: 1009,
      openPullRequests: [],
      activeLaneIssueNumbers: [1009],
    })
    expect(result.blocked).toBe(true)
  })

  it('passes a clean new dispatch under the cap with no duplicate', () => {
    const result = evaluateDispatchPreflight({
      isNewImplementationDispatch: true,
      issueNumber: 1250,
      openPullRequests: [{ number: 1, body: 'Primary-Issue: #1' }],
    })
    expect(result).toEqual({ blocked: false, reasons: [] })
  })
})
