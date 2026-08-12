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
      { host: 'example.com', count: 1, foreignCount: 0, error: null },
      { host: 'legacy.example.com', count: 0, foreignCount: 0, error: null },
    ])
  })

  it('🔴 只返回了别的主机的 URL → 本主机记 0 条（「找到东西」≠「找到这个站的东西」）', async () => {
    // crawler 的同源过滤是宽松的（剥 www + 前缀比较），跑 A 主机时可能只带回 B 的 URL。
    // 按返回总条数记账，A 就被记成「有页面」，那道「0 条必须有人认」的闸永远不响。
    vi.mocked(discoverSitemapUrls).mockImplementation(async (host) =>
      host === 'www.example.com'
        ? ['https://example.com/a', 'https://example.com/b'] // 全是裸域的页面
        : ['https://example.com/a'],
    )
    const outcome = await discoverCandidateUrls(['example.com', 'www.example.com'])
    const www = outcome.perHost.find((h) => h.host === 'www.example.com')
    expect(www).toMatchObject({ count: 0, foreignCount: 2 })
  })

  it('🔴 发现过程中被吞掉的失败要记成 error（部分结果不许当完整结果）', async () => {
    // discoverSitemapUrls 每一级回退都会吞掉失败继续走：一棵子 sitemap 取不到、
    // 其余还有结果时它正常返回 —— 部分结果长得跟完整结果一模一样。
    vi.mocked(discoverSitemapUrls).mockImplementation(async (host, opts) => {
      opts?.onIssue?.({ stage: 'child-sitemap', url: `https://${host}/sitemap-2.xml`, error: 'HTTP 503' })
      return [`https://${host}/a`]
    })
    const outcome = await discoverCandidateUrls(['example.com'])
    expect(outcome.perHost[0].count).toBe(1)
    expect(outcome.perHost[0].error).toContain('被吞掉')
    expect(outcome.perHost[0].error).toContain('sitemap-2.xml')
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
