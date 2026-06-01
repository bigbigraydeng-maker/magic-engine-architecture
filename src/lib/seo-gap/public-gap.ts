import { calculateOpportunityScore, recommendPageType } from '@/lib/scoring/opportunity-score'
import { getKeywordsGap, getSerpCompetitors, type LabsCompetitor, type LabsKeyword } from '@/lib/dataforseo/labs'
import type { KeywordIntent, PageType } from '@/types/magic-engine'

export type PublicGapMarket = 'au' | 'nz'

const LOCATION_CODE_BY_MARKET: Record<PublicGapMarket, number> = {
  au: 2036,
  nz: 2554,
}

const GENERIC_DOMAIN_BLOCKLIST = new Set([
  'facebook.com', 'instagram.com', 'youtube.com', 'twitter.com', 'x.com',
  'reddit.com', 'linkedin.com', 'pinterest.com', 'tiktok.com', 'snapchat.com',
  'google.com', 'google.com.au', 'google.co.nz',
  'wikipedia.org', 'wikimedia.org',
  'amazon.com', 'amazon.com.au', 'ebay.com', 'ebay.com.au',
  'yelp.com', 'trustpilot.com', 'glassdoor.com',
  'apple.com', 'microsoft.com',
  'tripadvisor.com', 'tripadvisor.com.au', 'tripadvisor.co.nz',
  'booking.com', 'expedia.com', 'expedia.com.au', 'expedia.co.nz',
  'hotels.com', 'agoda.com', 'airbnb.com', 'hostelworld.com',
])

export interface PublicGapKeyword {
  keyword: string
  volume: number
  kd: number
  cpc: number
  intent: KeywordIntent
  opportunity_score: number
  recommended_page_type: PageType
  competitors: string[]
}

export interface PublicGapMarketResult {
  market: PublicGapMarket
  location_code: number
  competitors: LabsCompetitor[]
  keyword_gap: PublicGapKeyword[]
  summary: {
    competitor_count: number
    gap_count: number
    top_keyword_count: number
  }
}

export interface PublicGapReport {
  domain: string
  markets: PublicGapMarketResult[]
  generated_at: string
}

export async function getPublicKeywordGapReport(
  domain: string,
  markets: PublicGapMarket[] = ['au', 'nz'],
  limit = 100,
): Promise<PublicGapReport> {
  const normalizedDomain = normalizeDomain(domain)
  const uniqueMarkets = Array.from(new Set(markets))

  const marketResults = await Promise.all(
    uniqueMarkets.map(market => getPublicKeywordGapMarket(normalizedDomain, market, limit)),
  )

  return {
    domain: normalizedDomain,
    markets: marketResults,
    generated_at: new Date().toISOString(),
  }
}

export async function getPublicKeywordGapMarket(
  domain: string,
  market: PublicGapMarket,
  limit = 100,
): Promise<PublicGapMarketResult> {
  const locationCode = LOCATION_CODE_BY_MARKET[market]

  const rawCompetitors = await getSerpCompetitors(domain, locationCode, 20)
  const competitors = rawCompetitors.filter(c => !GENERIC_DOMAIN_BLOCKLIST.has(c.domain))
  const topCompetitorDomains = competitors.slice(0, 3).map(c => c.domain)

  const gapKeywords: LabsKeyword[] = topCompetitorDomains.length > 0
    ? await getKeywordsGap(domain, topCompetitorDomains, locationCode, limit)
    : []

  const keywordGap = gapKeywords
    .map(kw => toPublicGapKeyword(kw, topCompetitorDomains))
    .sort((a, b) => {
      if (b.opportunity_score !== a.opportunity_score) return b.opportunity_score - a.opportunity_score
      return b.volume - a.volume
    })
    .slice(0, limit)

  return {
    market,
    location_code: locationCode,
    competitors: competitors.slice(0, 5),
    keyword_gap: keywordGap,
    summary: {
      competitor_count: competitors.length,
      gap_count: gapKeywords.length,
      top_keyword_count: keywordGap.length,
    },
  }
}

function toPublicGapKeyword(kw: LabsKeyword, competitors: string[]): PublicGapKeyword {
  const intent = normalizeIntent(kw.intent)
  const volume = kw.search_volume ?? 0
  const kd = kw.keyword_difficulty ?? 0
  const cpc = kw.cpc ?? 0

  return {
    keyword: kw.keyword,
    volume,
    kd,
    cpc,
    intent,
    opportunity_score: calculateOpportunityScore({ volume, kd, cpc, intent, isGap: true }),
    recommended_page_type: recommendPageType(kw.keyword, intent, volume),
    competitors,
  }
}

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, '')
}

function normalizeIntent(intent?: string | null): KeywordIntent {
  if (intent === 'commercial' || intent === 'transactional' || intent === 'navigational') return intent
  return 'informational'
}
