import { describe, expect, it } from 'vitest'
import { buildMergeAuthMarker, isMergeAuthorized, selectTrustedMergeAuthRecords } from '../src/merge-auth.mjs'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

describe('buildMergeAuthMarker', () => {
  it('round-trips through selectTrustedMergeAuthRecords', () => {
    const marker = buildMergeAuthMarker({ pr: 861, headSha: SHA_A, authorizedBy: 'owner', authorizedAt: '2026-08-29T00:00:00Z' })
    const records = selectTrustedMergeAuthRecords({
      comments: [{ author: 'owner', body: marker }],
      allowlist: ['owner'],
    })
    expect(records).toEqual([{ pr: 861, head_sha: SHA_A, authorized_by: 'owner', authorized_at: '2026-08-29T00:00:00Z' }])
  })

  it('refuses to build a marker from a non-full SHA', () => {
    expect(() =>
      buildMergeAuthMarker({ pr: 861, headSha: 'abc1234', authorizedBy: 'owner', authorizedAt: '2026-08-29T00:00:00Z' })
    ).toThrow(/non-full SHA/)
  })
})

describe('selectTrustedMergeAuthRecords', () => {
  it('drops markers from an author not on the allowlist', () => {
    const marker = buildMergeAuthMarker({ pr: 861, headSha: SHA_A, authorizedBy: 'attacker', authorizedAt: '2026-08-29T00:00:00Z' })
    const records = selectTrustedMergeAuthRecords({
      comments: [{ author: 'attacker', body: marker }],
      allowlist: ['owner'],
    })
    expect(records).toEqual([])
  })

  it('drops a malformed marker (short SHA embedded directly)', () => {
    const records = selectTrustedMergeAuthRecords({
      comments: [{ author: 'owner', body: '<!-- ME_MERGE_AUTH_V1: {"pr":861,"head_sha":"short","authorized_by":"owner","authorized_at":"2026-08-29T00:00:00Z"} -->' }],
      allowlist: ['owner'],
    })
    expect(records).toEqual([])
  })
})

describe('isMergeAuthorized', () => {
  const trustedRecord = { pr: 861, head_sha: SHA_A, authorized_by: 'owner', authorized_at: '2026-08-29T00:00:00Z' }

  it('authorizes when a trusted record names the exact current head', () => {
    const result = isMergeAuthorized({ records: [trustedRecord], prNumber: 861, currentHeadSha: SHA_A })
    expect(result).toEqual({ authorized: true, record: trustedRecord })
  })

  // Fixture #7: an old merge-auth SHA fails after the PR head moves.
  it('fails once the PR head moves past the authorized SHA', () => {
    const result = isMergeAuthorized({ records: [trustedRecord], prNumber: 861, currentHeadSha: SHA_B })
    expect(result.authorized).toBe(false)
  })

  it('is case-insensitive on SHA comparison', () => {
    const result = isMergeAuthorized({ records: [trustedRecord], prNumber: 861, currentHeadSha: SHA_A.toUpperCase() })
    expect(result.authorized).toBe(true)
  })

  it('does not authorize a different PR number even at the same SHA', () => {
    const result = isMergeAuthorized({ records: [trustedRecord], prNumber: 999, currentHeadSha: SHA_A })
    expect(result.authorized).toBe(false)
  })

  it('fails closed when the current head SHA is unreadable', () => {
    const result = isMergeAuthorized({ records: [trustedRecord], prNumber: 861, currentHeadSha: '' })
    expect(result.authorized).toBe(false)
  })

  it('picks the newest record when two authorize the same exact head', () => {
    const older = trustedRecord
    const newer = { ...trustedRecord, authorized_at: '2026-08-30T00:00:00Z' }
    const result = isMergeAuthorized({ records: [older, newer], prNumber: 861, currentHeadSha: SHA_A })
    expect(result.authorized).toBe(true)
    expect(result.authorized && result.record.authorized_at).toBe('2026-08-30T00:00:00Z')
  })
})
