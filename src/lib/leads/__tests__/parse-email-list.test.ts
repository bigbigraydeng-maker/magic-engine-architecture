import { describe, expect, it } from 'vitest'
import { parseEmailList } from '../parse-email-list'

describe('parseEmailList', () => {
  it('accepts a newline-separated list', () => {
    const r = parseEmailList('115parkhomes@gmail.com\nroman.hu@raywhite.com')
    expect(r.emails).toEqual(['115parkhomes@gmail.com', 'roman.hu@raywhite.com'])
    expect(r.rejected).toEqual([])
  })

  it('accepts comma/semicolon separated input', () => {
    const r = parseEmailList('a@example.com, b@example.com; c@example.com')
    expect(r.emails).toEqual(['a@example.com', 'b@example.com', 'c@example.com'])
  })

  it('accepts an array', () => {
    const r = parseEmailList(['A@Example.com', 'b@example.com'])
    // lowercased + deduped
    expect(r.emails).toEqual(['a@example.com', 'b@example.com'])
  })

  it('rejects things that are not email addresses, keeps the good ones', () => {
    const r = parseEmailList('good@example.com\nJason Wong\nnotanemail')
    expect(r.emails).toEqual(['good@example.com'])
    expect(r.rejected).toEqual(['Jason Wong', 'notanemail'])
  })

  it('dedupes case-insensitively', () => {
    const r = parseEmailList('same@example.com\nSAME@example.com')
    expect(r.emails).toEqual(['same@example.com'])
  })

  it('ignores blank lines', () => {
    const r = parseEmailList('a@example.com\n\n\nb@example.com')
    expect(r.emails).toEqual(['a@example.com', 'b@example.com'])
  })

  it('returns empty for non-string, non-array input', () => {
    expect(parseEmailList(undefined)).toEqual({ emails: [], rejected: [] })
    expect(parseEmailList(42)).toEqual({ emails: [], rejected: [] })
  })

  it('rejects an address over the length cap', () => {
    const long = `${'a'.repeat(160)}@example.com`
    const r = parseEmailList(long)
    expect(r.emails).toEqual([])
    expect(r.rejected).toEqual([long])
  })
})
