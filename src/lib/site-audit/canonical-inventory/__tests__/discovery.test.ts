/**
 * 逐主机发现（Issue #930）。
 *
 * 🔴 盯的是一种**缺页**的静默失败：批准清单里有两个互不链接的独立站点时，
 *    只跑第一个的 robots / sitemap / 首页，第二个站的页面根本不会进候选，
 *    复核和激活照样成功 —— 产出一份缺页的台账。
 *    缺页比多页危险：多的会被人看见并拒掉，缺的没人会发现。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { discoverCandidateUrls } from '../adapters'
import { discoverSitemapUrls } from '../../crawler'

vi.mock('../../crawler', () => ({
  crawlPages: vi.fn(),
  discoverSitemapUrls: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('discoverCandidateUrls', () => {
  it('🔴 每个批准主机各发现一遍，结果合并去重', async () => {
    vi.mocked(discoverSitemapUrls).mockImplementation(async (host) =>
      host === 'example.com'
        ? ['https://example.com/a', 'https://example.com/b']
        : ['https://shop.example.com/x'],
    )
    const outcome = await discoverCandidateUrls(['example.com', 'shop.example.com'])

    expect(vi.mocked(discoverSitemapUrls).mock.calls.map((c) => c[0])).toEqual([
      'example.com',
      'shop.example.com',
    ])
    expect(outcome.urls).toEqual([
      'https://example.com/a',
      'https://example.com/b',
      'https://shop.example.com/x',
    ])
  })

  it('同一个 URL 被两个主机发现时只留一条', async () => {
    vi.mocked(discoverSitemapUrls).mockResolvedValue(['https://example.com/a'])
    const outcome = await discoverCandidateUrls(['example.com', 'www.example.com'])
    expect(outcome.urls).toEqual(['https://example.com/a'])
  })

  it('🔴 逐主机条数原样返回 —— 某个站 0 条不许被合并结果盖住', async () => {
    vi.mocked(discoverSitemapUrls).mockImplementation(async (host) =>
      host === 'example.com' ? ['https://example.com/a'] : [],
    )
    const outcome = await discoverCandidateUrls(['example.com', 'legacy.example.com'])
    expect(outcome.perHost).toEqual([
      { host: 'example.com', count: 1, error: null },
      { host: 'legacy.example.com', count: 0, error: null },
    ])
  })

  it('一个主机挂掉不影响别的主机，但必须留痕（否则跟「没有页面」长得一样）', async () => {
    vi.mocked(discoverSitemapUrls).mockImplementation(async (host) => {
      if (host === 'broken.example.com') throw new Error('DNS lookup failed')
      return ['https://example.com/a']
    })
    const outcome = await discoverCandidateUrls(['broken.example.com', 'example.com'])
    expect(outcome.urls).toEqual(['https://example.com/a'])
    expect(outcome.perHost[0]).toMatchObject({ host: 'broken.example.com', count: 0 })
    expect(outcome.perHost[0].error).toContain('DNS lookup failed')
  })
})
