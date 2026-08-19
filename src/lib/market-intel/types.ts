export type MarketIntelCategory =
  | 'ai_startup'
  | 'marketing'
  | 'meta_ads'
  | 'google_ads'
  | 'tiktok_ads'
  | 'llm_pricing'

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

/** An item that passed the 48h window + dedupe + category match — this is what goes straight into the email. */
export interface CandidateItem {
  sourceName: string
  title: string
  url: string
  publishedAt: string | null
  excerpt: string
  matchedCategory: MarketIntelCategory
  dedupeHash: string
}
