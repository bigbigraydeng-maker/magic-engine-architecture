// ============================================
// Magic Engine — Core Types
// ============================================

export type ClientPlan = 'starter' | 'growth' | 'enterprise'
export type KeywordIntent = 'informational' | 'commercial' | 'transactional' | 'navigational'
export type KeywordSource = 'semrush_batch' | 'semrush_related' | 'semrush_gap'
export type KeywordStatus = 'new' | 'reviewed' | 'approved' | 'rejected' | 'page_created' | 'published'
export type PageType = 'hub' | 'guide' | 'landing' | 'faq'
export type ContentRoute = 'route_a' | 'route_b' | 'route_c'
export type ContentStatus = 'draft' | 'approved' | 'scheduled' | 'published' | 'rejected'
export type VisualProvider = 'wavespeed' | 'seedance' | 'heygen'
export type VisualType = 'image' | 'video' | 'avatar_video'

export interface Client {
  id: string
  name: string
  domain?: string
  semrush_db: string
  monthly_quota: number
  plan_tier: ClientPlan
  airtable_base_id?: string
  created_at: string
}

export interface MasterBrief {
  id: string
  client_id: string
  version: number
  is_active: boolean
  brand_name: string
  tagline?: string
  website?: string
  primary_audience?: string
  pain_points?: string[]
  buying_trigger?: string
  products?: Product[]
  tone?: string
  voice_examples?: string[]
  avoid_words?: string[]
  content_topics?: string[]
  content_avoid?: string[]
  platforms?: string[]
  post_frequency?: string
  visual_style?: string
  color_palette?: string[]
  image_preference?: string
}

export interface Product {
  name: string
  description: string
  price_range?: string
  season?: string
  usp?: string
}

export interface Keyword {
  id: string
  client_id: string
  keyword: string
  volume?: number
  kd?: number
  cpc?: number
  intent?: KeywordIntent
  trend?: TrendPoint[]
  source: KeywordSource
  competitor_source?: string
  semrush_db: string
  opportunity_score?: number
  recommended_page_type?: PageType
  status: KeywordStatus
  airtable_record_id?: string
  created_at: string
  updated_at: string
}

export interface TrendPoint {
  month: string   // 'YYYY-MM'
  volume: number
}

export interface ContentPost {
  id: string
  client_id: string
  title: string
  route: ContentRoute
  platforms: string[]
  script?: string
  caption?: string
  hashtags?: string[]
  visual_brief?: string
  revision_notes?: string
  source_keyword_id?: string
  source_video_url?: string
  source_brief_id?: string
  status: ContentStatus
  scheduled_at?: string
  published_at?: string
  publer_post_id?: string
  airtable_record_id?: string
}

// API Request/Response types
export interface KeywordOverviewRequest {
  keywords: string[]      // max 100
  client_id: string
  db?: string
}

export interface KeywordOverviewResponse {
  success: boolean
  data: Keyword[]
  units_consumed: number
  saved_count: number
  errors?: string[]
}

export interface RelatedKeywordsRequest {
  seed_keyword: string
  client_id: string
  limit?: number          // default 50, max 100
  min_volume?: number     // default 100
  max_kd?: number         // default 60
  db?: string
}

export interface CompetitorKeywordsRequest {
  competitor_domains: string[]  // max 4
  client_id: string
  limit?: number
  min_volume?: number
  db?: string
}

export interface KeywordGapRequest {
  client_domain: string
  competitor_domains: string[]  // 1-4
  client_id: string
  limit?: number
  min_volume?: number
  max_kd?: number
  db?: string
}

export interface ApiError {
  success: false
  error: string
  code: 'SEMRUSH_API_ERROR' | 'QUOTA_EXCEEDED' | 'INVALID_INPUT' | 'SUPABASE_ERROR' | 'RATE_LIMITED'
}
