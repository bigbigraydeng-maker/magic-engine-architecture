// ============================================
// Magic Engine — Core Types
// ============================================

export type ClientPlan = 'starter' | 'growth' | 'enterprise'
export type KeywordIntent = 'informational' | 'commercial' | 'transactional' | 'navigational'
export type KeywordSource = 'semrush_batch' | 'semrush_related' | 'semrush_gap' | 'campaign' | 'master_brief' | 'manual' | 'airtable'
export type KeywordStatus = 'new' | 'reviewed' | 'approved' | 'rejected' | 'page_created' | 'published'
export type PageType = 'hub' | 'guide' | 'landing' | 'faq'
export type ContentRoute = 'route_a' | 'route_b' | 'route_c'
export type ContentStatus = 'draft' | 'approved' | 'scheduled' | 'published' | 'rejected'
export type VisualProvider = 'wavespeed' | 'seedance' | 'heygen'
export type VisualType = 'image' | 'video' | 'avatar_video'
export type CampaignStatus = 'active' | 'archived'
export type ContentMode = 'brand' | 'campaign'

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

// ── Master Brief pipeline types ───────────────────────────────────────────────

export type BriefStatus = 'draft' | 'active' | 'archived'

export interface ContentPillar {
  id: string               // slug, e.g. "educational"
  name: string             // display name
  description: string
  post_ratio: number       // 0–1, fraction of posts
  content_types: string[]  // e.g. ["how-to", "tips"]
  example_topics?: string[]
}

export interface BrandVoice {
  tone_keywords: string[]
  avoid_keywords: string[]
  formality: 'casual' | 'neutral' | 'professional'
  emoji_usage: 'none' | 'minimal' | 'moderate'
  language_mix?: string    // e.g. "english-primary"
}

export interface TargetAudience {
  age_range?: string
  location?: string
  gender?: string
  interests: string[]
  pain_points: string[]
  platforms: string[]
}

export interface PlatformConfig {
  enabled: boolean
  post_frequency: string   // e.g. "5x/week"
  primary_content_type: string
}

export interface VIColors {
  primary?: string
  secondary?: string
  accent?: string
  background?: string
}

export interface BriefChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp?: string
}

export interface MasterBrief {
  id: string
  client_id: string
  version: number
  /** @deprecated use status instead */
  is_active?: boolean
  status: BriefStatus

  // Structured fields (machine-readable)
  brand_name?: string | null
  core_proposition?: string | null
  content_pillars?: ContentPillar[] | null
  brand_voice?: BrandVoice | null
  target_audience?: TargetAudience | null
  platform_strategy?: Record<string, PlatformConfig> | null
  keyword_seeds?: string[] | null
  competitor_domains?: string[] | null

  // VI visual guidelines
  vi_colors?: VIColors | null
  vi_style_keywords?: string[] | null
  vi_dos?: string[] | null
  vi_donts?: string[] | null

  // Rich text
  brand_story_md?: string | null
  style_guide_md?: string | null
  competitive_notes_md?: string | null

  // Source data
  source_file_urls?: string[] | null
  source_website_urls?: string[] | null
  semrush_snapshot?: Record<string, unknown> | null

  // Generation metadata
  generated_by?: 'claude' | 'manual'
  input_tokens?: number | null
  model_used?: string | null

  // Legacy fields (kept for backward compat with brief-injector)
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

  created_at?: string
  updated_at?: string
}

// API types for brief pipeline
export interface BriefGenerateRequest {
  website_urls: string[]   // max 5
  file_urls: string[]      // Supabase Storage URLs, max 10
  domain?: string          // for SEMrush lookup
}

export interface BriefGenerateResponse {
  success: boolean
  brief?: MasterBrief
  error?: string
  job_id?: string          // for async polling
}

export interface BriefRefineRequest {
  message: string
  history: BriefChatMessage[]
}

export interface BriefRefineResponse {
  success: boolean
  patch?: Partial<MasterBrief>
  reasoning?: string
  updated_brief?: MasterBrief
  error?: string
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

export interface CampaignKeywordSnapshot {
  keyword: string
  volume: number
  kd: number
  intent: string
  type: 'product' | 'question' | 'related'
}

export interface CampaignBrief {
  id: string
  client_id: string
  status: CampaignStatus
  title: string
  description?: string | null
  source_urls?: string[] | null
  source_file_urls?: string[] | null
  parsed_content?: string | null
  semrush_keywords?: CampaignKeywordSnapshot[] | null
  valid_from?: string | null
  valid_until?: string | null
  created_at: string
  updated_at: string
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
  campaign_id?: string | null
  content_mode?: ContentMode
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
