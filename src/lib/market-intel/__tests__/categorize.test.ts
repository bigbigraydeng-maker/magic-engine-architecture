import { describe, it, expect } from 'vitest'
import { hasPhrase, matchCategory } from '../categorize'
import type { RawFeedItem } from '../types'

function item(title: string, excerpt = ''): RawFeedItem {
  return { title, url: 'https://example.com/x', publishedAt: null, excerpt }
}

describe('hasPhrase', () => {
  it('matches case-insensitively', () => {
    expect(hasPhrase('Meta ADS manager update', 'meta ads')).toBe(true)
  })

  it('requires the full phrase, not just the individual tokens', () => {
    // 关键场景（魏征审查指出的具体风险）：拆词匹配会让"Meta 财报"这类泛科技新闻
    // 误判进 meta_ads——完整短语匹配则不会，因为 "meta ads" 不是子串。
    expect(hasPhrase('Meta reports quarterly ads revenue growth', 'meta ads')).toBe(false)
  })
})

describe('matchCategory', () => {
  it('requires a whitelist phrase hit for gated categories like meta_ads', () => {
    const hit = item('Meta rolls out new Advantage+ audience controls')
    expect(matchCategory(hit, ['meta_ads'])).toBe('meta_ads')

    const miss = item('Meta reports record quarterly earnings')
    expect(matchCategory(miss, ['meta_ads'])).toBeNull()
  })

  it('passes through ungated categories (ai_startup / marketing) without a phrase check', () => {
    const anything = item('A small company announced something unrelated to ads')
    expect(matchCategory(anything, ['ai_startup'])).toBe('ai_startup')
  })

  it('tries candidate categories in order and returns the first hit when both match', () => {
    // 标题同时命中 meta_ads 和 google_ads 的白名单短语，顺序决定归属。
    const both = item('New Meta Ads and Google Ads integration launches')
    expect(matchCategory(both, ['google_ads', 'meta_ads'])).toBe('google_ads')
    expect(matchCategory(both, ['meta_ads', 'google_ads'])).toBe('meta_ads')
  })

  it('returns null when nothing matches', () => {
    const irrelevant = item('Local council approves new bike lane')
    expect(matchCategory(irrelevant, ['meta_ads', 'google_ads', 'tiktok_ads'])).toBeNull()
  })
})
