/**
 * 张骞 Zhangqian — Discovery Agent type definitions.
 *
 * Reference: ROADMAP.md P8.10.S0
 *
 * Naming: 张骞 (Zhāng Qiān, ~164–113 BCE) was the Han dynasty diplomat who
 * pioneered the Silk Road by mapping the previously-unknown Western Regions
 * over a 13-year expedition. Our Discovery Agent mirrors that mission:
 * given only a domain, it autonomously maps the unknown territory of a
 * client's digital presence (competitors, social, reviews, keywords).
 */

// ─── Discovered sub-entities ──────────────────────────────────────────────────

export type SocialPlatform =
  | 'instagram'
  | 'facebook'
  | 'linkedin'
  | 'youtube'
  | 'tiktok'
  | 'twitter'
  | 'pinterest'

export interface DiscoveredSocial {
  platform: SocialPlatform
  handle: string | null            // e.g. "@oztopbuilding" — null if URL-only
  url: string                       // canonical profile URL
  confidence: number                // 0–1: how sure are we this is the right account
}

export interface DiscoveredGbp {
  place_id: string | null           // Google Places place_id if found
  business_name: string
  address: string
  rating: number | null             // 1–5
  review_count: number | null
  google_maps_url: string | null
  confidence: number                // 0–1
}

export interface DiscoveredReviewPlatform {
  platform: 'google' | 'productreview' | 'trustpilot' | 'yelp' | 'facebook' | 'other'
  url: string
  rating: number | null             // platform-specific scale
  review_count: number | null
}

export type KeywordType = 'brand' | 'category' | 'long_tail' | 'local' | 'transactional'

export interface DiscoveredKeyword {
  keyword: string
  type: KeywordType
  rationale: string                 // why Claude picked this
  estimated_volume?: number | null  // optional: rough volume guess
}

export type CompetitorRelevance = 'direct' | 'adjacent' | 'aspirational'

export interface DiscoveredCompetitor {
  domain: string                    // canonical, no protocol, no trailing slash
  name: string                      // human-readable brand
  relevance: CompetitorRelevance
  rationale: string                 // why this competitor matters
  location?: string | null          // city/region if local-market relevant
}

export type AiQuestionCategory = 'brand' | 'category' | 'comparison' | 'local'
export type Market = 'AU' | 'NZ' | 'AU/NZ'

export interface DiscoveredAiQuestion {
  question: string                  // exact wording for AI Tracker
  category: AiQuestionCategory
  market: Market
  rationale: string
}

export interface DiscoveredBusiness {
  name: string                      // brand name (not domain)
  industry: string[]                // 1–3 industry tags, broad to specific
  location: {
    city: string | null
    region: string | null            // QLD, NSW, Auckland, etc.
    country: 'AU' | 'NZ' | 'AU/NZ'
  }
  description: string                // 2–3 sentence brand summary
  target_audience: string[]          // e.g. ["builders", "home owners", "designers"]
  unique_selling_points: string[]    // e.g. ["one-team install", "free measure"]
  confidence: number                 // 0–1
}

// ─── Top-level report ─────────────────────────────────────────────────────────

export interface DiscoveryReport {
  /** Schema version — increment when shape changes incompatibly */
  schema_version: 1

  domain: string                                          // input
  business: DiscoveredBusiness
  social_profiles: DiscoveredSocial[]
  gbp: DiscoveredGbp | null
  review_platforms: DiscoveredReviewPlatform[]
  seed_keywords: DiscoveredKeyword[]                      // 5–10 expected
  competitors: DiscoveredCompetitor[]                     // 5–10 expected
  ai_tracker_questions: DiscoveredAiQuestion[]            // 10–20 expected

  /** Free-form research notes / caveats the agent wants the human to know */
  notes: string

  /** Run telemetry — written by agent.ts, not by Claude */
  meta: {
    model: string
    tool_calls: number
    cost_usd: number
    duration_ms: number
    truncated: boolean              // true if hit tool-call cap before finishing
  }
}

// ─── Job / persistence shapes ─────────────────────────────────────────────────

export type DiscoveryJobStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface DiscoveryJob {
  id: string
  client_id: string
  domain: string
  status: DiscoveryJobStatus
  progress_note: string | null
  tool_call_count: number
  cost_usd: number
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export interface ClientDiscoveryRow {
  id: string
  client_id: string
  domain: string
  payload: DiscoveryReport
  cost_usd: number
  model: string
  tool_calls: number
  generated_at: string
  expires_at: string
  confirmed_at: string | null
  confirmed_by: string | null
}
