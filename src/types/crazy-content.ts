/**
 * CrazyContent - Core Type Definitions
 * All types for content generation, social media management, and feedback systems
 */

// ============================================================================
// Content Generation Types
// ============================================================================

/**
 * Platform-specific and language-specific captions
 */
export interface SocialCaptionsV1 {
  facebook: {
    zh?: string;
    en?: string;
  };
  xiaohongshu: {
    zh?: string;
    en?: string;
  };
  suggested_image_keywords?: string[];
}

/**
 * Content task - represents a scheduled content generation
 */
export interface ContentTask {
  id: string;
  project_id: string;
  topic_id?: string;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  platforms: ('facebook' | 'xiaohongshu')[];
  generated_captions?: SocialCaptionsV1;
  image_url?: string;
  image_metadata?: {
    width?: number;
    height?: number;
    alt_text?: string;
    source?: string;
  };
  scheduled_at?: Date;
  published_at?: Date;
  error_message?: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Content topic - user-defined topic for content generation
 */
export interface ContentTopic {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  keywords: string[];
  target_audience?: string;
  tone: 'professional' | 'casual' | 'inspirational';
  frequency_daily: number;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// Social Media Types
// ============================================================================

/**
 * Connected social media account
 */
export interface SocialSource {
  id: string;
  project_id: string;
  platform: 'facebook' | 'xiaohongshu';
  account_id: string;
  account_name?: string;
  api_token?: string;
  token_expires_at?: Date;
  last_sync_at?: Date;
  last_error?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Engagement metrics from social media posts
 */
export interface EngagementMetrics {
  likes: number;
  comments: number;
  shares: number;
  views: number;
}

/**
 * Collected post from social media
 */
export interface CollectedPost {
  id: string;
  source_id: string;
  external_post_id: string;
  platform: 'facebook' | 'xiaohongshu';
  content: string;
  image_urls?: string[];
  original_url?: string;
  published_at?: Date;
  metrics: EngagementMetrics;
  collected_at: Date;
}

// ============================================================================
// Feedback & Analytics Types
// ============================================================================

/**
 * Engagement feedback data with scoring and sentiment
 */
export interface FeedbackData {
  id: string;
  collected_post_id: string;
  content_task_id?: string;
  engagement_score: number; // 0-100
  sentiment: 'positive' | 'neutral' | 'negative';
  trending_topics?: string[];
  audience_segment?: string;
  peak_hours?: number[];
  synced_at: Date;
}

/**
 * Trending topic with engagement metrics
 */
export interface TrendingTopic {
  topic: string;
  count: number;
  avg_engagement_score: number;
  sentiment: 'positive' | 'neutral' | 'negative';
}

/**
 * Daily trending report
 */
export interface TrendingReport {
  id: string;
  project_id: string;
  report_date: Date;
  report_content: {
    trending_topics: TrendingTopic[];
    top_posts: CollectedPost[];
    sentiment_distribution: {
      positive: number;
      neutral: number;
      negative: number;
    };
    peak_posting_hours: number[];
    recommendations: string[];
  };
  generated_at: Date;
}

// ============================================================================
// Generation & Optimization Types
// ============================================================================

/**
 * Generation log entry for auditing and cost tracking
 */
export interface GenerationLog {
  id: string;
  project_id: string;
  task_id?: string;
  operation: 'generate_copy' | 'generate_image' | 'scrape_feedback' | 'create_report';
  input_prompt?: Record<string, unknown>;
  output_result?: Record<string, unknown>;
  cost_usd?: number;
  duration_ms?: number;
  status: 'success' | 'failed';
  error_message?: string;
  created_at: Date;
}

/**
 * Generation parameters for content creation with feedback optimization
 */
export interface GenerationParams {
  id: string;
  project_id: string;
  topic_id?: string;
  platform: 'facebook' | 'xiaohongshu';
  prompt_template?: string;
  model: string;
  temperature: number; // 0.3-0.9
  max_tokens: number;
  tone_weight: number; // 0.5-1.5
  engagement_optimization_enabled: boolean;
  last_optimized_at?: Date;
  optimization_notes?: string;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * Generate content request
 */
export interface GenerateContentRequest {
  project_id: string;
  topic_ids: string[];
  platforms: ('facebook' | 'xiaohongshu')[];
  image_option?: 'unsplash' | 'dalle';
}

/**
 * Generate content response
 */
export interface GenerateContentResponse {
  task_id: string;
  status: 'generating' | 'pending';
  estimated_wait_ms: number;
}

/**
 * Standard API response envelope
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
  };
  metadata?: {
    total?: number;
    page?: number;
    limit?: number;
  };
}
