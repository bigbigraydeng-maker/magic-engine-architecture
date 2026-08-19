import type { MarketIntelSourceConfig } from './types'

/**
 * 设计文档 §5（2026-08-20 实测，全部返回真实 RSS）—— 每个 URL 逐个用 curl
 * 验证过返回的是真 RSS（不是 HTML SPA 页面伪装成的假 feed），已知死链见文档，
 * 没有列进这里。
 *
 * Hacker News（Algolia API）在设计文档里标注为"交叉验证用"，是关键词查询接口
 * 不是标准 RSS，需要独立于本模块的抓取逻辑，Phase 1 先不接，留给后续版本。
 */
export const MARKET_INTEL_SOURCES: MarketIntelSourceConfig[] = [
  {
    name: 'TechCrunch AI',
    feedUrl: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    categories: ['ai_startup'],
  },
  {
    name: 'VentureBeat AI',
    feedUrl: 'https://venturebeat.com/category/ai/feed/',
    categories: ['ai_startup', 'llm_pricing'],
  },
  {
    name: 'Search Engine Land',
    feedUrl: 'https://searchengineland.com/feed',
    categories: ['marketing', 'google_ads'],
  },
  {
    name: 'Search Engine Journal',
    feedUrl: 'https://www.searchenginejournal.com/feed/',
    categories: ['marketing'],
  },
  {
    name: 'SEJ · PPC',
    feedUrl: 'https://www.searchenginejournal.com/category/pay-per-click/feed/',
    categories: ['google_ads', 'meta_ads'],
  },
  {
    name: 'Marketing Dive',
    feedUrl: 'https://www.marketingdive.com/feeds/news/',
    categories: ['marketing'],
  },
  {
    name: 'AdExchanger',
    feedUrl: 'https://www.adexchanger.com/feed/',
    categories: ['meta_ads', 'google_ads', 'tiktok_ads'],
  },
  {
    name: 'Digiday',
    feedUrl: 'https://digiday.com/feed/',
    categories: ['marketing', 'tiktok_ads'],
  },
  {
    name: 'Social Media Today',
    // 注意不是 /rss.xml、/rss/ ——两个都 404，正确路径是 /feeds/news/。
    feedUrl: 'https://www.socialmediatoday.com/feeds/news/',
    categories: ['meta_ads', 'tiktok_ads'],
  },
  {
    name: 'HubSpot Marketing Blog',
    feedUrl: 'https://blog.hubspot.com/marketing/rss.xml',
    categories: ['marketing'],
  },
  {
    name: 'PPC.org',
    feedUrl: 'https://ppc.org/feed/',
    categories: ['google_ads', 'meta_ads'],
  },
  {
    name: 'OpenAI News',
    feedUrl: 'https://openai.com/news/rss.xml',
    categories: ['llm_pricing', 'ai_startup'],
  },
]
