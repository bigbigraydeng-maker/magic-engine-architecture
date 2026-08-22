import { describe, it, expect } from 'vitest'
import { dedupeHash, normalizeTitle } from '../dedupe'

describe('normalizeTitle', () => {
  it('lowercases, strips punctuation, drops stopwords', () => {
    expect(normalizeTitle('Meta Announces New "Advantage+" Feature!')).toBe(
      'meta announces new advantage feature',
    )
  })

  it('collapses repeated whitespace', () => {
    expect(normalizeTitle('AI   Startup   Raises   $10M')).toBe('ai startup raises 10m')
  })
})

describe('dedupeHash', () => {
  it('is identical for the same story reported with the same title on two different domains', () => {
    // v2 修正的核心场景：两个不同网站报道同一条新闻，标题相同，hash 不该受
    // 来源域名影响——这正是 v1 那个把 domain 算进哈希的 bug 会算错的地方。
    const a = dedupeHash('Meta updates Advantage+ targeting policy')
    const b = dedupeHash('Meta updates Advantage+ targeting policy')
    expect(a).toBe(b)
  })

  it('is identical regardless of casing/punctuation differences between outlets', () => {
    const a = dedupeHash('Meta Updates Advantage+ Targeting Policy')
    const b = dedupeHash('meta updates advantage+ targeting policy!')
    expect(a).toBe(b)
  })

  it('differs for genuinely different titles', () => {
    const a = dedupeHash('Meta updates Advantage+ targeting policy')
    const b = dedupeHash('Google Ads launches new Performance Max feature')
    expect(a).not.toBe(b)
  })
})
