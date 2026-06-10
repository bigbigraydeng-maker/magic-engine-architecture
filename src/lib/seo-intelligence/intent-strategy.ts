export type SearchIntent = 'transactional' | 'commercial' | 'informational' | 'navigational'

export interface IntentKeyword {
  keyword: string
  position?: number | null
  search_volume: number | null
  keyword_difficulty: number | null
  intent: string
}

export interface TrafficSplitBucket {
  keywords: number
  estimated_traffic: number
  search_volume: number
  share: number
}

export interface BrandTrafficSplit {
  branded: TrafficSplitBucket
  non_branded: TrafficSplitBucket
}

export interface ContentPriorityKeyword extends IntentKeyword {
  is_branded: boolean
  estimated_traffic: number
}

const INTENT_WEIGHT: Record<SearchIntent, number> = {
  transactional: 0,
  commercial: 1,
  informational: 2,
  navigational: 3,
}

export function isBrandedKeyword(keyword: string, brandRoot: string): boolean {
  const normalizedBrand = brandRoot.trim().toLowerCase()
  if (!normalizedBrand) return false

  return keyword
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .some(token => token === normalizedBrand)
}

/**
 * Branded-keyword detection that also honours clients.brand_aliases.
 *
 * The base {@link isBrandedKeyword} uses strict token-equality against a
 * single-word domain root ("ctstours"). That misses real brand searches whose
 * tokens never equal the root — e.g. the multi-word brand "cts tours" splits
 * into ["cts", "tours"], neither of which equals "ctstours", so the Organic
 * Rankings "Branded vs Non-Branded" card reported Branded 0% for CTS / Oztop.
 *
 * This wrapper layers substring matching against the PM-configured
 * `brand_aliases` array (same matcher shape as `isBrandQueryMatch` used for
 * GSC brand-search volume in PR #336) on top of the unchanged token-equality
 * fallback. Clients without aliases behave exactly as before.
 *
 * NOTE: deliberately does NOT mutate `isBrandedKeyword` — callers that rely on
 * its strict token-equality semantics (e.g. the SEO content agent assembler)
 * stay untouched (CLAUDE.md constraint).
 */
export function isBrandedKeywordWithAliases(
  keyword: string,
  brandRoot: string,
  brandAliases?: string[] | null,
): boolean {
  if (Array.isArray(brandAliases)) {
    const k = normaliseBrandTerm(keyword)
    if (k) {
      for (const alias of brandAliases) {
        if (typeof alias !== 'string') continue
        const a = normaliseBrandTerm(alias)
        if (a.length >= 2 && k.includes(a)) return true
      }
    }
  }
  return isBrandedKeyword(keyword, brandRoot)
}

/**
 * Lowercase + collapse internal whitespace. Keeps inner spaces so multi-word
 * aliases ("cts tours") stay matchable as a substring of "cts tours auckland".
 */
function normaliseBrandTerm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function estimateKeywordTraffic(keyword: IntentKeyword): number {
  const volume = keyword.search_volume ?? 0
  if (volume <= 0) return 0

  return Math.round(volume * ctrForPosition(keyword.position ?? null))
}

export function buildBrandTrafficSplit(
  keywords: IntentKeyword[],
  brandRoot: string,
  brandAliases?: string[] | null,
): BrandTrafficSplit {
  const totals = {
    branded: buildEmptyBucket(),
    non_branded: buildEmptyBucket(),
  }

  for (const keyword of keywords) {
    const bucket = isBrandedKeywordWithAliases(keyword.keyword, brandRoot, brandAliases)
      ? totals.branded
      : totals.non_branded
    bucket.keywords += 1
    bucket.search_volume += keyword.search_volume ?? 0
    bucket.estimated_traffic += estimateKeywordTraffic(keyword)
  }

  const totalTraffic = totals.branded.estimated_traffic + totals.non_branded.estimated_traffic
  return {
    branded: withShare(totals.branded, totalTraffic),
    non_branded: withShare(totals.non_branded, totalTraffic),
  }
}

export function prioritizeContentKeywords(
  keywords: IntentKeyword[],
  brandRoot: string,
  limit = 8,
  brandAliases?: string[] | null,
): ContentPriorityKeyword[] {
  return keywords
    .map(keyword => ({
      ...keyword,
      is_branded: isBrandedKeywordWithAliases(keyword.keyword, brandRoot, brandAliases),
      estimated_traffic: estimateKeywordTraffic(keyword),
    }))
    .filter(keyword => !keyword.is_branded)
    .filter(keyword => keyword.intent !== 'navigational')
    .sort(compareByContentPriority)
    .slice(0, limit)
}

export function sortByIntentPriority<T extends IntentKeyword>(
  keywords: T[],
  brandRoot: string,
  brandAliases?: string[] | null,
): T[] {
  return [...keywords].sort((a, b) => {
    const aBranded = isBrandedKeywordWithAliases(a.keyword, brandRoot, brandAliases)
    const bBranded = isBrandedKeywordWithAliases(b.keyword, brandRoot, brandAliases)
    return intentWeight(a.intent) - intentWeight(b.intent) ||
      Number(aBranded) - Number(bBranded) ||
      (b.search_volume ?? 0) - (a.search_volume ?? 0) ||
      (a.keyword_difficulty ?? 999) - (b.keyword_difficulty ?? 999) ||
      (a.position ?? 999) - (b.position ?? 999)
  })
}

function compareByContentPriority(a: ContentPriorityKeyword, b: ContentPriorityKeyword): number {
  return intentWeight(a.intent) - intentWeight(b.intent) ||
    (b.search_volume ?? 0) - (a.search_volume ?? 0) ||
    (a.keyword_difficulty ?? 999) - (b.keyword_difficulty ?? 999) ||
    (a.position ?? 999) - (b.position ?? 999)
}

function intentWeight(intent: string): number {
  return INTENT_WEIGHT[intent as SearchIntent] ?? INTENT_WEIGHT.informational
}

function ctrForPosition(position: number | null): number {
  if (position === null || position <= 0) return 0
  if (position === 1) return 0.28
  if (position === 2) return 0.15
  if (position === 3) return 0.11
  if (position <= 5) return 0.07
  if (position <= 10) return 0.035
  if (position <= 20) return 0.012
  if (position <= 50) return 0.004
  return 0.001
}

function buildEmptyBucket(): TrafficSplitBucket {
  return {
    keywords: 0,
    estimated_traffic: 0,
    search_volume: 0,
    share: 0,
  }
}

function withShare(bucket: TrafficSplitBucket, totalTraffic: number): TrafficSplitBucket {
  return {
    ...bucket,
    share: totalTraffic > 0 ? Math.round((bucket.estimated_traffic / totalTraffic) * 100) : 0,
  }
}
