import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { evaluateDispatchPreflight } from '../src/dispatch-preflight.mjs'
import { RECOVERY_OPEN_PR_CAP } from '../src/pr-cap.mjs'

const filler = (count: number) => Array.from({ length: count }, (_unused, i) => ({ number: i, body: '' }))

describe('evaluateDispatchPreflight', () => {
  it('does not apply to a non-new-implementation trigger (PR review/remediation comment)', () => {
    const result = evaluateDispatchPreflight({
      isNewImplementationDispatch: false,
      issueNumber: 1009,
      openPullRequests: filler(999),
    })
    expect(result.blocked).toBe(false)
  })

  it('fails closed when the issue number could not be determined', () => {
    expect(
      evaluateDispatchPreflight({ isNewImplementationDispatch: true, issueNumber: null, openPullRequests: [] }).blocked
    ).toBe(true)
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

  // No PR exists yet for this lane, so the open-PR list is already the
  // pre-creation count: 12 open means this dispatch would be the thirteenth.
  it('admits a dispatch that would be the twelfth open PR and blocks the thirteenth', () => {
    const under = evaluateDispatchPreflight({
      isNewImplementationDispatch: true,
      issueNumber: 5000,
      openPullRequests: filler(RECOVERY_OPEN_PR_CAP - 1),
    })
    expect(under.blocked).toBe(false)

    const over = evaluateDispatchPreflight({
      isNewImplementationDispatch: true,
      issueNumber: 5000,
      openPullRequests: filler(RECOVERY_OPEN_PR_CAP),
    })
    expect(over.blocked).toBe(true)
  })

  it('lets a verified override past the cap but not past a duplicate', () => {
    const override = {
      primary_issue: 1009,
      granted_by: 'owner',
      reason: 'recovery',
      expires_at: '2026-08-30T00:00:00Z',
    }
    const capOnly = evaluateDispatchPreflight({
      isNewImplementationDispatch: true,
      issueNumber: 1009,
      openPullRequests: filler(RECOVERY_OPEN_PR_CAP),
      capOverride: override,
    })
    expect(capOnly.blocked).toBe(false)

    const alsoDuplicate = evaluateDispatchPreflight({
      isNewImplementationDispatch: true,
      issueNumber: 1009,
      openPullRequests: [{ number: 1007, body: 'Primary-Issue: #1009' }, ...filler(RECOVERY_OPEN_PR_CAP)],
      capOverride: override,
    })
    expect(alsoDuplicate.blocked).toBe(true)
  })

  it('passes a clean new dispatch under the cap with no duplicate', () => {
    const result = evaluateDispatchPreflight({
      isNewImplementationDispatch: true,
      issueNumber: 1250,
      openPullRequests: [{ number: 1, body: 'Primary-Issue: #1' }],
    })
    expect(result).toEqual({ blocked: false, reasons: [] })
  })

  // The same-Issue race is closed by the global concurrency group in
  // claude.yml. A permanently empty "active lanes" array would read like a
  // working check and never be one, so the parameter does not exist.
  it('carries no active-lane parameter for a caller to fake', () => {
    const source = readFileSync(join(process.cwd(), 'tools/build-control/src/dispatch-preflight.mjs'), 'utf8')
    expect(source).not.toContain('activeLaneIssueNumbers')
    const cli = readFileSync(join(process.cwd(), 'tools/build-control/src/dispatch-preflight-cli.mjs'), 'utf8')
    expect(cli).not.toContain('activeLaneIssueNumbers')
  })
})
