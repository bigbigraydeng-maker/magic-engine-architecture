/**
 * 张骞 Zhangqian — runtime validators for Claude's JSON output.
 *
 * Pure TypeScript guards (no Zod dependency). Each validator returns either
 * { ok: true, value } or { ok: false, error } — never throws — so the agent
 * can decide whether to retry, repair, or fail.
 *
 * Reference: ROADMAP.md P8.10.S0.6
 */

import type {
  DiscoveryReport,
  DiscoveredBusiness,
  DiscoveredSocial,
  DiscoveredGbp,
  DiscoveredReviewPlatform,
  DiscoveredKeyword,
  DiscoveredCompetitor,
  DiscoveredAiQuestion,
  SocialPlatform,
  KeywordType,
  CompetitorRelevance,
  AiQuestionCategory,
  Market,
} from './types'

// ─── Result type ──────────────────────────────────────────────────────────────

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

// ─── Primitive helpers ────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isString = (v: unknown): v is string => typeof v === 'string'
const isNumber = (v: unknown): v is number => typeof v === 'number' && !Number.isNaN(v)
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(isString)

const inRange = (n: number, min: number, max: number): boolean =>
  n >= min && n <= max

// ─── Enum sets (kept inline for fast lookup, mirrors types.ts) ───────────────

const SOCIAL_PLATFORMS: ReadonlySet<SocialPlatform> = new Set<SocialPlatform>([
  'instagram', 'facebook', 'linkedin', 'youtube', 'tiktok', 'twitter', 'pinterest',
])

const KEYWORD_TYPES: ReadonlySet<KeywordType> = new Set<KeywordType>([
  'brand', 'category', 'long_tail', 'local', 'transactional',
])

const COMPETITOR_RELEVANCE: ReadonlySet<CompetitorRelevance> = new Set<CompetitorRelevance>([
  'direct', 'adjacent', 'aspirational',
])

const AI_QUESTION_CATEGORIES: ReadonlySet<AiQuestionCategory> = new Set<AiQuestionCategory>([
  'brand', 'category', 'comparison', 'local',
])

const MARKETS: ReadonlySet<Market> = new Set<Market>(['AU', 'NZ', 'AU/NZ'])

const COUNTRIES: ReadonlySet<DiscoveredBusiness['location']['country']> = new Set<
  DiscoveredBusiness['location']['country']
>(['AU', 'NZ', 'AU/NZ'])

const REVIEW_PLATFORMS: ReadonlySet<DiscoveredReviewPlatform['platform']> = new Set<
  DiscoveredReviewPlatform['platform']
>(['google', 'productreview', 'trustpilot', 'yelp', 'facebook', 'other'])

// ─── Field-level guards ───────────────────────────────────────────────────────

function isBusiness(v: unknown): v is DiscoveredBusiness {
  if (!isRecord(v)) return false
  if (!isString(v.name) || v.name.length === 0) return false
  if (!isStringArray(v.industry) || v.industry.length === 0) return false
  if (!isRecord(v.location)) return false
  const loc = v.location
  if (loc.city !== null && !isString(loc.city)) return false
  if (loc.region !== null && !isString(loc.region)) return false
  if (!isString(loc.country) || !COUNTRIES.has(loc.country as Market)) return false
  if (!isString(v.description) || v.description.length === 0) return false
  if (!isStringArray(v.target_audience)) return false
  if (!isStringArray(v.unique_selling_points)) return false
  if (!isNumber(v.confidence) || !inRange(v.confidence, 0, 1)) return false
  return true
}

function isSocial(v: unknown): v is DiscoveredSocial {
  if (!isRecord(v)) return false
  if (!isString(v.platform) || !SOCIAL_PLATFORMS.has(v.platform as SocialPlatform)) return false
  if (v.handle !== null && !isString(v.handle)) return false
  if (!isString(v.url) || !v.url.startsWith('http')) return false
  if (!isNumber(v.confidence) || !inRange(v.confidence, 0, 1)) return false
  return true
}

function isGbp(v: unknown): v is DiscoveredGbp {
  if (!isRecord(v)) return false
  if (v.place_id !== null && !isString(v.place_id)) return false
  if (!isString(v.business_name)) return false
  if (!isString(v.address)) return false
  if (v.rating !== null && (!isNumber(v.rating) || !inRange(v.rating, 0, 5))) return false
  if (v.review_count !== null && (!isNumber(v.review_count) || v.review_count < 0)) return false
  if (v.google_maps_url !== null && !isString(v.google_maps_url)) return false
  if (!isNumber(v.confidence) || !inRange(v.confidence, 0, 1)) return false
  return true
}

function isReviewPlatform(v: unknown): v is DiscoveredReviewPlatform {
  if (!isRecord(v)) return false
  if (!isString(v.platform) || !REVIEW_PLATFORMS.has(v.platform as DiscoveredReviewPlatform['platform'])) return false
  if (!isString(v.url)) return false
  if (v.rating !== null && !isNumber(v.rating)) return false
  if (v.review_count !== null && !isNumber(v.review_count)) return false
  return true
}

function isKeyword(v: unknown): v is DiscoveredKeyword {
  if (!isRecord(v)) return false
  if (!isString(v.keyword) || v.keyword.length === 0) return false
  if (!isString(v.type) || !KEYWORD_TYPES.has(v.type as KeywordType)) return false
  if (!isString(v.rationale)) return false
  if (v.estimated_volume !== undefined && v.estimated_volume !== null && !isNumber(v.estimated_volume)) return false
  return true
}

function isCompetitor(v: unknown): v is DiscoveredCompetitor {
  if (!isRecord(v)) return false
  if (!isString(v.domain) || v.domain.length === 0) return false
  if (!isString(v.name) || v.name.length === 0) return false
  if (!isString(v.relevance) || !COMPETITOR_RELEVANCE.has(v.relevance as CompetitorRelevance)) return false
  if (!isString(v.rationale)) return false
  if (v.location !== undefined && v.location !== null && !isString(v.location)) return false
  return true
}

function isAiQuestion(v: unknown): v is DiscoveredAiQuestion {
  if (!isRecord(v)) return false
  if (!isString(v.question) || v.question.length === 0) return false
  if (!isString(v.category) || !AI_QUESTION_CATEGORIES.has(v.category as AiQuestionCategory)) return false
  if (!isString(v.market) || !MARKETS.has(v.market as Market)) return false
  if (!isString(v.rationale)) return false
  return true
}

// ─── Top-level validator ──────────────────────────────────────────────────────

/**
 * Validate the body of a Claude response. Caller is responsible for stripping
 * any markdown fences before passing the parsed JSON in. `meta` is NOT part of
 * Claude's output (set by agent.ts) and is not checked here.
 */
export function validateDiscoveryReport(
  v: unknown,
): ValidationResult<Omit<DiscoveryReport, 'meta'>> {
  if (!isRecord(v)) return { ok: false, error: 'root is not an object' }

  if (v.schema_version !== 1) {
    return { ok: false, error: `schema_version must be 1, got ${String(v.schema_version)}` }
  }

  if (!isString(v.domain) || v.domain.length === 0) {
    return { ok: false, error: 'domain is missing or empty' }
  }

  if (!isBusiness(v.business)) {
    return { ok: false, error: 'business block is invalid (check required fields)' }
  }

  if (!Array.isArray(v.social_profiles) || !v.social_profiles.every(isSocial)) {
    return { ok: false, error: 'social_profiles must be an array of DiscoveredSocial' }
  }

  if (v.gbp !== null && !isGbp(v.gbp)) {
    return { ok: false, error: 'gbp must be null or a valid DiscoveredGbp' }
  }

  if (!Array.isArray(v.review_platforms) || !v.review_platforms.every(isReviewPlatform)) {
    return { ok: false, error: 'review_platforms must be an array of DiscoveredReviewPlatform' }
  }

  if (!Array.isArray(v.seed_keywords) || !v.seed_keywords.every(isKeyword)) {
    return { ok: false, error: 'seed_keywords must be an array of DiscoveredKeyword' }
  }
  if (v.seed_keywords.length < 3) {
    return { ok: false, error: `seed_keywords must contain at least 3 entries (got ${v.seed_keywords.length})` }
  }

  if (!Array.isArray(v.competitors) || !v.competitors.every(isCompetitor)) {
    return { ok: false, error: 'competitors must be an array of DiscoveredCompetitor' }
  }
  if (v.competitors.length < 3) {
    return { ok: false, error: `competitors must contain at least 3 entries (got ${v.competitors.length})` }
  }

  if (!Array.isArray(v.ai_tracker_questions) || !v.ai_tracker_questions.every(isAiQuestion)) {
    return { ok: false, error: 'ai_tracker_questions must be an array of DiscoveredAiQuestion' }
  }
  if (v.ai_tracker_questions.length < 5) {
    return { ok: false, error: `ai_tracker_questions must contain at least 5 entries (got ${v.ai_tracker_questions.length})` }
  }

  if (!isString(v.notes)) {
    return { ok: false, error: 'notes must be a string (empty string allowed)' }
  }

  return {
    ok: true,
    value: {
      schema_version: 1,
      domain: v.domain,
      business: v.business,
      social_profiles: v.social_profiles,
      gbp: v.gbp,
      review_platforms: v.review_platforms,
      seed_keywords: v.seed_keywords,
      competitors: v.competitors,
      ai_tracker_questions: v.ai_tracker_questions,
      notes: v.notes,
    },
  }
}

/**
 * Strip common markdown wrappers Claude sometimes leaks despite instructions
 * to emit raw JSON. Returns the cleaned string ready for JSON.parse().
 */
export function stripJsonFences(raw: string): string {
  let s = raw.trim()
  // ```json … ```
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  return s.trim()
}
