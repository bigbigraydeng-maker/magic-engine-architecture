import { describe, expect, it } from 'vitest'
import {
  buildBrandTrafficSplit,
  estimateKeywordTraffic,
  isBrandedKeyword,
  isBrandedKeywordWithAliases,
  prioritizeContentKeywords,
  sortByIntentPriority,
  type IntentKeyword,
} from '../intent-strategy'

function keyword(
  keywordText: string,
  intent: string,
  overrides: Partial<IntentKeyword> = {},
): IntentKeyword {
  return {
    keyword: keywordText,
    intent,
    position: 5,
    search_volume: 100,
    keyword_difficulty: 30,
    ...overrides,
  }
}

describe('intent strategy helpers', () => {
  it('detects branded keywords by token match', () => {
    expect(isBrandedKeyword('cts tours new zealand', 'cts')).toBe(true)
    expect(isBrandedKeyword('best tours in new zealand', 'cts')).toBe(false)
    expect(isBrandedKeyword('oz top flooring', 'oztop')).toBe(false)
  })

  // CTS Tours NZ — domain root "ctstours", brand_aliases configured by PM.
  // The single-word root never matches multi-word brand searches via
  // token-equality, so brand_aliases substring matching is required.
  const CTS_ALIASES = ['cts', 'cts tours', 'cts travel', 'ctstours', 'china travel service']
  // Oztop Building Supplies — domain root "oztopbuildingsupplies".
  const OZTOP_ALIASES = ['oztop', 'oz top', 'oztop building supplies']

  it('matches CTS branded keywords via brand_aliases substring', () => {
    for (const kw of ['cts tours', 'cts', 'ctstours', 'cts travel', 'cts tour']) {
      expect(isBrandedKeywordWithAliases(kw, 'ctstours', CTS_ALIASES)).toBe(true)
    }
  })

  it('matches Oztop branded keywords via brand_aliases substring', () => {
    for (const kw of ['oztop building supplies', 'oztop', 'oz top']) {
      expect(isBrandedKeywordWithAliases(kw, 'oztopbuildingsupplies', OZTOP_ALIASES)).toBe(true)
    }
  })

  it('keeps generic non-branded keywords out of the branded bucket', () => {
    expect(isBrandedKeywordWithAliases('china tours', 'ctstours', CTS_ALIASES)).toBe(false)
    expect(isBrandedKeywordWithAliases('flooring brisbane', 'oztopbuildingsupplies', OZTOP_ALIASES)).toBe(false)
  })

  it('falls back to token-equality on brandRoot when no aliases configured', () => {
    // No aliases → identical behaviour to isBrandedKeyword (no regression).
    expect(isBrandedKeywordWithAliases('cts tours new zealand', 'cts', null)).toBe(true)
    expect(isBrandedKeywordWithAliases('best tours in new zealand', 'cts', null)).toBe(false)
    expect(isBrandedKeywordWithAliases('oz top flooring', 'oztop', undefined)).toBe(false)
  })

  it('splits traffic using brand_aliases so multi-word brands are branded', () => {
    // Regression for the 0% Branded bug: "cts tours" / "cts" must land in the
    // branded bucket even though neither token equals the domain root.
    const split = buildBrandTrafficSplit([
      keyword('cts tours', 'navigational', { position: 1, search_volume: 1000 }),
      keyword('cts', 'navigational', { position: 1, search_volume: 1000 }),
      keyword('private nz tour package', 'transactional', { position: 1, search_volume: 1000 }),
    ], 'ctstours', CTS_ALIASES)

    expect(split.branded.keywords).toBe(2)
    expect(split.non_branded.keywords).toBe(1)
    expect(split.branded.share).toBeGreaterThan(0)
  })

  it('estimates traffic from position and volume', () => {
    expect(estimateKeywordTraffic(keyword('top tour', 'transactional', {
      position: 1,
      search_volume: 1000,
    }))).toBe(280)
    expect(estimateKeywordTraffic(keyword('deep tour', 'commercial', {
      position: 30,
      search_volume: 1000,
    }))).toBe(4)
  })

  it('splits estimated traffic into branded and non-branded buckets', () => {
    const split = buildBrandTrafficSplit([
      keyword('cts tours', 'navigational', { position: 1, search_volume: 1000 }),
      keyword('new zealand private tours', 'transactional', { position: 2, search_volume: 1000 }),
    ], 'cts')

    expect(split.branded).toMatchObject({
      keywords: 1,
      estimated_traffic: 280,
      search_volume: 1000,
      share: 65,
    })
    expect(split.non_branded).toMatchObject({
      keywords: 1,
      estimated_traffic: 150,
      search_volume: 1000,
      share: 35,
    })
  })

  it('prioritizes non-branded transactional and commercial keywords for content', () => {
    const priorities = prioritizeContentKeywords([
      keyword('cts tours', 'transactional', { search_volume: 900 }),
      keyword('what to pack nz', 'informational', { search_volume: 1000 }),
      keyword('nz private tour package', 'transactional', { search_volume: 400 }),
      keyword('new zealand tour company', 'commercial', { search_volume: 700 }),
    ], 'cts')

    expect(priorities.map(item => item.keyword)).toEqual([
      'nz private tour package',
      'new zealand tour company',
      'what to pack nz',
    ])
  })

  it('sorts ranking rows by transactional intent before volume and position', () => {
    const sorted = sortByIntentPriority([
      keyword('high volume guide', 'informational', { search_volume: 2000, position: 1 }),
      keyword('buy nz tour', 'transactional', { search_volume: 100, position: 8 }),
      keyword('compare tour companies', 'commercial', { search_volume: 500, position: 4 }),
    ], 'cts')

    expect(sorted.map(item => item.keyword)).toEqual([
      'buy nz tour',
      'compare tour companies',
      'high volume guide',
    ])
  })
})
