import { describe, expect, it } from 'vitest'
import { extractPrimaryIssue } from '../src/primary-issue.mjs'

describe('extractPrimaryIssue', () => {
  it('reads the explicit field', () => {
    expect(extractPrimaryIssue('Primary-Issue: #1249\n\nbody')).toEqual({ ok: true, issueNumber: 1249 })
  })

  it('is case-insensitive on the label but requires the colon-hash shape', () => {
    expect(extractPrimaryIssue('primary-issue:   #7')).toEqual({ ok: true, issueNumber: 7 })
    expect(extractPrimaryIssue('Primary-Issue 7')).toEqual({ ok: false, reason: 'MISSING' })
  })

  it.each([['Related: #999'], ['Closes #999'], ['see #999 for context'], [''], ['Primary-Issue: #abc']])(
    'does not treat %j as a declaration',
    (body) => {
      expect(extractPrimaryIssue(body)).toEqual({ ok: false, reason: 'MISSING' })
    }
  )

  it('is missing on a null body', () => {
    expect(extractPrimaryIssue(null)).toEqual({ ok: false, reason: 'MISSING' })
  })

  it('is ambiguous when two different Primary-Issue numbers are declared', () => {
    expect(extractPrimaryIssue('Primary-Issue: #1\nPrimary-Issue: #2')).toEqual({ ok: false, reason: 'AMBIGUOUS' })
  })

  // Exactly one declaration means exactly one occurrence: repeating the same
  // number is a duplicate declaration, not a harmless restatement.
  it('is ambiguous when the same number is declared twice', () => {
    expect(extractPrimaryIssue('Primary-Issue: #1249\n\nbody\n\nPrimary-Issue: #1249')).toEqual({
      ok: false,
      reason: 'AMBIGUOUS',
    })
  })
})
