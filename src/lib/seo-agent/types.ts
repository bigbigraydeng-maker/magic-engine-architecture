import type { GoalRow } from '@/types/strategy'
import type { MasterBrief } from '@/types/magic-engine'

export type SeoCandidateSource = 'gap' | 'ranking' | 'position_change'
export type SeoActionType = 'create_money_page' | 'publish_support_content' | 'refresh_existing_page'
export type SeoPageType =
  | 'location_page'
  | 'service_page'
  | 'category_page'
  | 'comparison_article'
  | 'guide_article'

export type SeoExecutionPath = 'manual_page_brief' | 'blog_now' | 'page_upgrade'

export interface SeoAgentLocationContext {
  city: string | null
  region: string | null
  country: 'AU' | 'NZ' | 'AU/NZ'
  audience_location: string | null
}

export interface SeoAgentClientContext {
  id: string
  name: string
  domain: string
  semrush_db: string | null
  industry: string | null
}

export interface SeoKeywordCandidate {
  keyword: string
  source: SeoCandidateSource
  intent: string
  search_volume: number | null
  keyword_difficulty: number | null
  position: number | null
  previous_position: number | null
  position_delta: number | null
  has_business_match: boolean
  has_location_match: boolean
  action_type: SeoActionType
  page_type: SeoPageType
  execution_path: SeoExecutionPath
  score: number
}

export interface SeoAgentInput {
  client: SeoAgentClientContext
  goal: GoalRow | null
  brief: MasterBrief | null
  location: SeoAgentLocationContext
  candidates: SeoKeywordCandidate[]
  rankings_count: number
  gap_count: number
  position_change_count: number
}

export interface SeoOpportunity {
  keyword: string
  priority: 'high' | 'medium' | 'low'
  source: SeoCandidateSource
  action_type: SeoActionType
  page_type: SeoPageType
  execution_path: SeoExecutionPath
  suggested_title: string
  suggested_slug: string
  why_now: string
  business_fit: string
  recommended_mode: 'seo_only' | 'unified'
  score: number
}

export interface SeoAgentOutput {
  summary: string
  top_opportunities: SeoOpportunity[]
  skipped_keywords: string[]
}
