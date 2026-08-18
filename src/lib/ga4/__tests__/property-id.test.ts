import { describe, expect, it } from 'vitest'
import { normalizeGa4PropertyId, toGa4ResourceName } from '../property-id'

describe('normalizeGa4PropertyId', () => {
  it('accepts a bare numeric id (the format CTS/Oztop store historically)', () => {
    expect(normalizeGa4PropertyId('532503727')).toEqual({ ok: true, propertyId: '532503727' })
  })

  it('accepts a properties/-prefixed id and strips the prefix for canonical storage', () => {
    expect(normalizeGa4PropertyId('properties/550203806')).toEqual({ ok: true, propertyId: '550203806' })
  })

  it('trims surrounding whitespace (pasted from the GA4 UI often carries it)', () => {
    expect(normalizeGa4PropertyId('  550203806  ')).toEqual({ ok: true, propertyId: '550203806' })
  })

  it('rejects non-numeric input', () => {
    expect(normalizeGa4PropertyId('not-a-property-id')).toEqual({ ok: false })
  })

  it('rejects a properties/ prefix with a non-numeric suffix', () => {
    expect(normalizeGa4PropertyId('properties/abc')).toEqual({ ok: false })
  })

  it('rejects an empty string', () => {
    expect(normalizeGa4PropertyId('')).toEqual({ ok: false })
  })

  it('accepts a 20-digit id at the length cap', () => {
    const id = '1'.repeat(20)
    expect(normalizeGa4PropertyId(id)).toEqual({ ok: true, propertyId: id })
  })

  it('rejects a pathologically long digit string past the length cap (魏征 2026-08-18: no upper bound before this fix)', () => {
    const tooLong = '1'.repeat(21)
    expect(normalizeGa4PropertyId(tooLong)).toEqual({ ok: false })
    expect(normalizeGa4PropertyId('9'.repeat(5000))).toEqual({ ok: false })
  })
})

describe('toGa4ResourceName', () => {
  it('prefixes bare digits', () => {
    expect(toGa4ResourceName('550203806')).toBe('properties/550203806')
  })

  it('leaves an already-prefixed id unchanged', () => {
    expect(toGa4ResourceName('properties/550203806')).toBe('properties/550203806')
  })
})
