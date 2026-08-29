import { describe, expect, it } from 'vitest'
import { findDuplicatePrimaryIssues, isIssueClaimedByOpenPr } from '../src/duplicate-lane.mjs'

describe('findDuplicatePrimaryIssues', () => {
  // Fixture #1: two PRs with disjoint files but the same Primary-Issue are duplicates.
  // (File overlap plays no part here — only the declared field does.)
  it('flags two PRs declaring the same Primary-Issue', () => {
    const prs = [
      { number: 1007, body: 'Primary-Issue: #1009' },
      { number: 1243, body: 'Primary-Issue: #1009' },
    ]
    const result = findDuplicatePrimaryIssues(prs)
    expect(result.get(1009)).toEqual([1007, 1243])
  })

  // Fixture #2: Draft PRs count as open duplicates.
  it('counts a Draft PR toward the duplicate group', () => {
    const prs = [
      { number: 1007, body: 'Primary-Issue: #1009', isDraft: false },
      { number: 1243, body: 'Primary-Issue: #1009', isDraft: true },
    ]
    expect(findDuplicatePrimaryIssues(prs).get(1009)).toEqual([1007, 1243])
  })

  it('does not flag a single PR declaring an issue', () => {
    expect(findDuplicatePrimaryIssues([{ number: 1, body: 'Primary-Issue: #10' }]).size).toBe(0)
  })

  it('ignores PRs with no Primary-Issue field', () => {
    expect(findDuplicatePrimaryIssues([{ number: 1, body: 'no field here' }, { number: 2, body: 'also none' }]).size).toBe(0)
  })

  it('ignores PRs with an ambiguous Primary-Issue field', () => {
    const prs = [
      { number: 1, body: 'Primary-Issue: #10\nPrimary-Issue: #20' },
      { number: 2, body: 'Primary-Issue: #10' },
    ]
    // PR 1 is ambiguous and contributes nothing; PR 2 alone is not a duplicate.
    expect(findDuplicatePrimaryIssues(prs).size).toBe(0)
  })

  it('handles an empty list', () => {
    expect(findDuplicatePrimaryIssues([]).size).toBe(0)
  })
})

describe('isIssueClaimedByOpenPr', () => {
  it('reports the claiming PR numbers', () => {
    const prs = [{ number: 5, body: 'Primary-Issue: #1009' }]
    expect(isIssueClaimedByOpenPr({ pullRequests: prs, issueNumber: 1009 })).toEqual({ claimed: true, byPrNumbers: [5] })
  })

  it('excludes a given PR number (a PR checking its own claim is not a duplicate of itself)', () => {
    const prs = [{ number: 5, body: 'Primary-Issue: #1009' }]
    expect(isIssueClaimedByOpenPr({ pullRequests: prs, issueNumber: 1009, excludePrNumber: 5 })).toEqual({
      claimed: false,
      byPrNumbers: [],
    })
  })

  it('is unclaimed when no PR declares it', () => {
    expect(isIssueClaimedByOpenPr({ pullRequests: [], issueNumber: 1009 })).toEqual({ claimed: false, byPrNumbers: [] })
  })
})
