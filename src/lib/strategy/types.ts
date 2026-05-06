// Shared types for Phase 8.1 three-dimensional content strategy analysis

// ---------------------------------------------------------------------------
// Enums (mirror the Postgres enums)
// ---------------------------------------------------------------------------

export type ActionType = 'upgrade_page' | 'new_blog' | 'social_content'
export type ContentMode = 'unified' | 'geo_only' | 'seo_only'
export type StrategyPriority = 'critical' | 'high' | 'medium' | 'low'
export type StrategyStatus = 'pending' | 'approved' | 'in_progress' | 'done' | 'dismissed'

// ---------------------------------------------------------------------------
// Scorer input / output
// ---------------------------------------------------------------------------

/**
 * All the signals available when scoring a single opportunity.
 * Nulls mean the signal is absent (e.g. no keyword data was found).
 */
export interface ScoringContext {
  // Dimension C — existing page quality
  has_existing_page: boolean
  has_geo_block: boolean
  word_count: number | null
  page_type: string | null   // 'product' | 'service' | 'blog' | ...

  // Dimension A — AI Tracker weakness
  ai_weak: boolean
  ai_weak_model_count: number   // how many AI models returned weak/absent ranking

  // Dimension B — SEMrush keyword value
  keyword_volume: number | null
  keyword_kd: number | null     // 0–100; lower = easier to rank
}

export interface ScoringResult {
  priority_score: number        // 0–100
  priority: StrategyPriority
  action_type: ActionType
  content_mode: ContentMode
}

// ---------------------------------------------------------------------------
// Analyzer data shapes (fetched from DB)
// ---------------------------------------------------------------------------

export interface ClientSitePageSummary {
  id: string
  url: string
  title: string | null
  page_type: string
  topics: string[]
  primary_keyword: string | null
  word_count: number | null
  has_geo_block: boolean
}

export interface WeakAIQuery {
  id: string
  question: string
  avg_rank: number | null        // average rank across models (null = never mentioned)
  weak_model_count: number       // models where brand_rank IS NULL or > 3
}

export interface KeywordOpportunity {
  keyword: string
  volume: number
  kd: number
  intent: string
}

// ---------------------------------------------------------------------------
// Raw opportunity produced by the analyzer (pre-scoring)
// ---------------------------------------------------------------------------

export interface RawOpportunity {
  action_type: ActionType
  content_mode: ContentMode

  proposed_title: string
  rationale: string
  content_angle: string

  source_page_id: string | null
  source_query_id: string | null
  source_keyword: string | null
  keyword_volume: number | null
  keyword_kd: number | null

  // Signals forwarded to the scorer
  scoring_context: ScoringContext
}

// ---------------------------------------------------------------------------
// Final strategy item written to content_strategy_items
// ---------------------------------------------------------------------------

export interface StrategyItem {
  id: string
  client_id: string
  strategy_run_id: string

  action_type: ActionType
  content_mode: ContentMode
  priority: StrategyPriority
  priority_score: number

  proposed_title: string
  rationale: string
  content_angle: string | null

  source_page_id: string | null
  source_query_id: string | null
  source_keyword: string | null
  keyword_volume: number | null
  keyword_kd: number | null

  status: StrategyStatus
  linked_blog_post_id: string | null

  created_at: string
  updated_at: string
}
