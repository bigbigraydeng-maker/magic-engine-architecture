export type MarketIntelCategory =
  | 'ai_startup'
  | 'marketing'
  | 'meta_ads'
  | 'google_ads'
  | 'tiktok_ads'
  // 2026-08-21 从 llm_pricing 改名放宽：原来只收定价新闻,PM 要看 Grok/DeepSeek/
  // Claude/OpenAI 各家的动态,不该只窄到价格这一件事。
  | 'llm_news'
  | 'chatgpt_ads'
  | 'china_outbound'

export interface MarketIntelSourceConfig {
  name: string
  feedUrl: string
  categories: MarketIntelCategory[]
}

/** A single RSS entry after parsing, before dedupe/categorize. */
export interface RawFeedItem {
  title: string
  url: string
  publishedAt: string | null
  excerpt: string
}

/** An item that passed the 48h window + dedupe + category match. */
export interface CandidateItem {
  sourceId: string
  sourceName: string
  title: string
  url: string
  publishedAt: string | null
  rawExcerpt: string
  matchedCategory: MarketIntelCategory
  dedupeHash: string
}

export interface SummarizedItem extends CandidateItem {
  headlineZh: string
  summaryZh: string
  groundingCheck: 'passed' | 'failed'
}
