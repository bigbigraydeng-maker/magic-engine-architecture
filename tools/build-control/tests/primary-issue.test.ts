import { describe, expect, it } from 'vitest'
import { extractPrimaryIssue, hasExplicitPrimaryIssueField } from '../src/primary-issue.mjs'

describe('extractPrimaryIssue', () => {
  it('reads the explicit field', () => {
    expect(extractPrimaryIssue('Some body\n\nPrimary-Issue: #1009\n\nMore text')).toEqual({
      ok: true,
      issueNumber: 1009,
    })
  })

  it('is case-insensitive on the label but requires the colon-hash shape', () => {
    expect(extractPrimaryIssue('primary-issue: #42')).toEqual({ ok: true, issueNumber: 42 })
  })

  // Fixture #3: ambiguous references must not become the primary issue.
  it('does not treat `Related: #999` as a Primary-Issue declaration', () => {
    expect(extractPrimaryIssue('Related: #999\nCloses: #1001')).toEqual({ ok: false, reason: 'MISSING' })
    expect(hasExplicitPrimaryIssueField('Related: #999')).toBe(false)
  })

  it('does not treat a bare #999 mention as a declaration', () => {
    expect(extractPrimaryIssue('See #999 for background.')).toEqual({ ok: false, reason: 'MISSING' })
  })

  it('is missing on an empty or null body', () => {
    expect(extractPrimaryIssue('')).toEqual({ ok: false, reason: 'MISSING' })
    expect(extractPrimaryIssue(null)).toEqual({ ok: false, reason: 'MISSING' })
    expect(extractPrimaryIssue(undefined)).toEqual({ ok: false, reason: 'MISSING' })
  })

  it('is ambiguous when two different Primary-Issue numbers are declared', () => {
    expect(extractPrimaryIssue('Primary-Issue: #1009\nPrimary-Issue: #2000')).toEqual({
      ok: false,
      reason: 'AMBIGUOUS',
    })
  })

  it('is not ambiguous when the same number repeats', () => {
    expect(extractPrimaryIssue('Primary-Issue: #1009\n...\nPrimary-Issue: #1009')).toEqual({
      ok: true,
      issueNumber: 1009,
    })
  })

  it('hasExplicitPrimaryIssueField is stable across repeated calls (no global-regex lastIndex bug)', () => {
    const body = 'Primary-Issue: #1009'
    expect(hasExplicitPrimaryIssueField(body)).toBe(true)
    expect(hasExplicitPrimaryIssueField(body)).toBe(true)
    expect(hasExplicitPrimaryIssueField(body)).toBe(true)
  })
})
