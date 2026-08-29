import { describe, expect, it } from 'vitest'
import { buildMergeAuthMarker, isMergeAuthorized, selectTrustedMergeAuthRecords } from '../src/merge-auth.mjs'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const AT = '2026-08-29T00:00:00Z'
const record = { pr: 861, head_sha: SHA_A, authorized_by: 'owner', authorized_at: AT }

const marker = (overrides: Record<string, unknown> = {}) =>
  `<!-- ME_MERGE_AUTH_V1: ${JSON.stringify({ ...record, ...overrides })} -->`

describe('selectTrustedMergeAuthRecords', () => {
  it('round-trips a marker built by buildMergeAuthMarker', () => {
    const body = buildMergeAuthMarker({ pr: 861, headSha: SHA_A, authorizedBy: 'owner', authorizedAt: AT })
    expect(selectTrustedMergeAuthRecords({ comments: [{ author: 'owner', body }], allowlist: ['owner'] })).toEqual([
      record,
    ])
  })

  it('refuses to build a marker from a non-full SHA', () => {
    expect(() =>
      buildMergeAuthMarker({ pr: 861, headSha: 'abc1234', authorizedBy: 'owner', authorizedAt: AT })
    ).toThrow(/non-full SHA/)
  })

  it('drops a marker from an author not on the allowlist', () => {
    const comments = [{ author: 'attacker', body: marker({ authorized_by: 'attacker' }) }]
    expect(selectTrustedMergeAuthRecords({ comments, allowlist: ['owner'] })).toEqual([])
  })

  // An attacker quoting the owner's marker into their own comment must not
  // re-issue the owner's authorisation.
  it('drops a marker whose authorized_by does not match the comment author', () => {
    const comments = [{ author: 'owner', body: marker({ authorized_by: 'someone-else' }) }]
    expect(selectTrustedMergeAuthRecords({ comments, allowlist: ['owner', 'someone-else'] })).toEqual([])
  })

  it.each([
    ['a short SHA', { head_sha: 'short' }],
    ['a non-numeric PR', { pr: '861' }],
    ['an unparseable authorized_at', { authorized_at: 'whenever' }],
    ['a missing authorized_at', { authorized_at: undefined }],
  ])('drops a marker with %s', (_label, overrides) => {
    const comments = [{ author: 'owner', body: marker(overrides) }]
    expect(selectTrustedMergeAuthRecords({ comments, allowlist: ['owner'] })).toEqual([])
  })
})

describe('isMergeAuthorized', () => {
  it('authorizes when a trusted record names the exact current head', () => {
    expect(isMergeAuthorized({ records: [record], prNumber: 861, currentHeadSha: SHA_A })).toEqual({
      authorized: true,
      record,
    })
  })

  // A push invalidates prior authorisation with no revocation step.
  it('fails once the PR head moves past the authorized SHA', () => {
    expect(isMergeAuthorized({ records: [record], prNumber: 861, currentHeadSha: SHA_B }).authorized).toBe(false)
  })

  it('is case-insensitive on SHA comparison', () => {
    expect(isMergeAuthorized({ records: [record], prNumber: 861, currentHeadSha: SHA_A.toUpperCase() }).authorized).toBe(
      true
    )
  })

  it('does not authorize a different PR number even at the same SHA', () => {
    expect(isMergeAuthorized({ records: [record], prNumber: 999, currentHeadSha: SHA_A }).authorized).toBe(false)
  })

  it('fails closed when the current head SHA is unreadable', () => {
    expect(isMergeAuthorized({ records: [record], prNumber: 861, currentHeadSha: '' }).authorized).toBe(false)
  })

  it('picks the newest record when two authorize the same exact head', () => {
    const newer = { ...record, authorized_at: '2026-08-30T00:00:00Z' }
    const result = isMergeAuthorized({ records: [record, newer], prNumber: 861, currentHeadSha: SHA_A })
    expect(result.authorized && result.record.authorized_at).toBe(newer.authorized_at)
  })
})
