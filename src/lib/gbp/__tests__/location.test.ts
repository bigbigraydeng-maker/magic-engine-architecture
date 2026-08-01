/**
 * GBP location matching — the guard against publishing a client's content
 * on someone else's storefront.
 */

import { describe, expect, it } from 'vitest'
import { hostRoot, composeLocationResource, pickClientLocation } from '../location'

const loc = (name: string, title: string | null, websiteUri: string | null) => ({
  name, title, websiteUri,
})

const CTS = { domain: 'ctstours.co.nz', name: 'CTS Tours NZ' }

describe('hostRoot', () => {
  it('strips protocol, www and path', () => {
    expect(hostRoot('https://www.ctstours.co.nz/tours')).toBe('ctstours.co.nz')
    expect(hostRoot('HTTP://CTSTOURS.CO.NZ')).toBe('ctstours.co.nz')
    expect(hostRoot(null)).toBe('')
  })
})

describe('composeLocationResource', () => {
  it('joins the v1 bare location name onto the account path (v4 post needs both)', () => {
    expect(composeLocationResource('accounts/123', 'locations/456')).toBe('accounts/123/locations/456')
    expect(composeLocationResource('accounts/123/', 'locations/456')).toBe('accounts/123/locations/456')
  })

  it('passes through an already-qualified name unchanged', () => {
    expect(composeLocationResource('accounts/123', 'accounts/999/locations/456'))
      .toBe('accounts/999/locations/456')
  })
})

describe('pickClientLocation', () => {
  it('matches on website host first, even when another title looks similar', () => {
    const { match } = pickClientLocation([
      loc('locations/1', 'CTS Tours NZ', 'https://impostor.co.nz'),
      loc('locations/2', 'Some Other Trading Name', 'https://www.ctstours.co.nz'),
    ], CTS)
    expect(match?.name).toBe('locations/2')
  })

  it('falls back to an exact title match when no website matches', () => {
    const { match } = pickClientLocation([
      loc('locations/1', 'Unrelated Shop', null),
      loc('locations/2', 'cts tours nz', null),
    ], CTS)
    expect(match?.name).toBe('locations/2')
  })

  it('takes the only location when there is exactly one', () => {
    const { match } = pickClientLocation([loc('locations/9', 'Whatever Ltd', null)], CTS)
    expect(match?.name).toBe('locations/9')
  })

  it('refuses to guess between several unmatched locations', () => {
    const { match, reason } = pickClientLocation([
      loc('locations/1', 'Branch A', 'https://other-a.co.nz'),
      loc('locations/2', 'Branch B', 'https://other-b.co.nz'),
    ], CTS)
    expect(match).toBeNull()
    expect(reason).toBe('ambiguous')
  })

  it('refuses when the same host appears twice (cannot tell them apart)', () => {
    const { match, reason } = pickClientLocation([
      loc('locations/1', 'CTS Auckland', 'https://www.ctstours.co.nz'),
      loc('locations/2', 'CTS Christchurch', 'https://www.ctstours.co.nz'),
    ], CTS)
    expect(match).toBeNull()
    expect(reason).toBe('ambiguous')
  })

  it('reports no_locations for an empty account', () => {
    const { match, reason } = pickClientLocation([], CTS)
    expect(match).toBeNull()
    expect(reason).toBe('no_locations')
  })

  it('a client with no domain still matches by title', () => {
    const { match } = pickClientLocation(
      [loc('locations/1', 'Oztop Building Supplies', 'https://x.com')],
      { domain: null, name: 'Oztop Building Supplies' },
    )
    expect(match?.name).toBe('locations/1')
  })
})
