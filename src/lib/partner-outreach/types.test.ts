import { describe, it, expect } from 'vitest'
import { assertOfficialSourced, hasAnyVerifiedPlatform, normalizeDomain } from './types'

describe('assertOfficialSourced', () => {
  it('downgrades an unbacked "verified" claim to unknown', () => {
    const result = assertOfficialSourced({ meta: { status: 'verified' } })
    expect(result.meta?.status).toBe('unknown')
  })

  it('keeps a "verified" claim backed by a source_url', () => {
    const result = assertOfficialSourced({ meta: { status: 'verified', source_url: 'https://business.facebook.com/partners/x' } })
    expect(result.meta?.status).toBe('verified')
  })

  it('passes through unverified/unknown untouched', () => {
    const result = assertOfficialSourced({ google: { status: 'unverified' }, tiktok: { status: 'unknown' } })
    expect(result.google?.status).toBe('unverified')
    expect(result.tiktok?.status).toBe('unknown')
  })

  it('rejects a whitespace-only source_url as unbacked', () => {
    const result = assertOfficialSourced({ meta: { status: 'verified', source_url: '   ' } })
    expect(result.meta?.status).toBe('unknown')
  })
})

describe('hasAnyVerifiedPlatform', () => {
  it('false when nothing is verified', () => {
    expect(hasAnyVerifiedPlatform({ meta: { status: 'unverified' } })).toBe(false)
  })

  it('true when at least one platform is verified with a source', () => {
    expect(hasAnyVerifiedPlatform({
      meta: { status: 'unknown' },
      google: { status: 'verified', source_url: 'https://google.com/partners/x' },
    })).toBe(true)
  })
})

describe('normalizeDomain', () => {
  it('strips protocol, www, path and trailing slash', () => {
    expect(normalizeDomain('https://www.Acme.com.au/about/')).toBe('acme.com.au')
  })

  it('handles a bare domain already normalized', () => {
    expect(normalizeDomain('acme.co.nz')).toBe('acme.co.nz')
  })

  it('returns null for an empty string', () => {
    expect(normalizeDomain('  ')).toBeNull()
  })
})
