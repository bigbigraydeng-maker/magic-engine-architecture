import Parser from 'rss-parser'
import type { RawFeedItem } from './types'

/**
 * 2026-08-20 设计审魏征指出：13 个信源里不乏大媒体站（TechCrunch、VentureBeat、
 * HubSpot），对自动化高频请求可能有反爬/限流，v1 完全没提请求策略。
 * 用真实浏览器 UA + 合理超时，自己 fetch 再喂给 rss-parser 解析，而不是让
 * rss-parser 内部用默认 UA 请求（更容易被当成裸爬虫拦下来）。
 */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const FETCH_TIMEOUT_MS = 15_000

export class FeedFetchError extends Error {
  constructor(
    public readonly feedUrl: string,
    cause: unknown,
  ) {
    super(`Failed to fetch/parse feed ${feedUrl}: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'FeedFetchError'
  }
}

/**
 * 抓一个信源的 RSS，返回过去 windowHours 小时内发布的条目。
 * 请求本身失败（网络/超时/HTTP 非 2xx）会抛 FeedFetchError——调用方据此更新
 * 该信源的连续失败计数（§7.6 健康度监控，区分"请求失败"和"0 条新条目"）。
 * 解析成功但没有新条目不算失败，返回空数组。
 */
export async function fetchFeed(feedUrl: string, windowHours = 48): Promise<RawFeedItem[]> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let xml: string
  try {
    const res = await fetch(feedUrl, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    xml = await res.text()
  } catch (err) {
    throw new FeedFetchError(feedUrl, err)
  } finally {
    clearTimeout(timeoutId)
  }

  const parser = new Parser()
  let feed: Parser.Output<Record<string, unknown>>
  try {
    feed = await parser.parseString(xml)
  } catch (err) {
    throw new FeedFetchError(feedUrl, err)
  }

  const cutoff = Date.now() - windowHours * 60 * 60 * 1000

  return (feed.items ?? [])
    .filter((entry) => {
      if (!entry.pubDate) return true // 没有发布时间的条目保守放行，别整批丢
      const published = new Date(entry.pubDate).getTime()
      return !Number.isNaN(published) && published >= cutoff
    })
    .map((entry) => ({
      title: (entry.title ?? '').trim(),
      url: entry.link ?? '',
      publishedAt: entry.pubDate ?? null,
      excerpt: (entry.contentSnippet ?? entry.content ?? '').trim().slice(0, 2000),
    }))
    .filter((item) => item.title.length > 0 && item.url.length > 0)
}
