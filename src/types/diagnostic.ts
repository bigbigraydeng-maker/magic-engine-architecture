// ============================================
// Diagnostic Engine — Core Types (P8.5.1)
// ============================================

export type DiagnosticDimension =
  | 'seo'
  | 'ai_visibility'
  | 'ads'
  | 'social'
  | 'reputation'
  | 'competitor'

export type DiagnosticSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export type FixType = 'me_auto' | 'fde_manual' | 'third_party'

// ── Finding Types (Appendix A) ────────────────────────────────────────────────

export type SeoFindingType =
  | 'missing_meta_title'
  | 'missing_meta_description'
  | 'thin_content'
  | 'missing_schema_markup'
  | 'broken_internal_links'
  | 'duplicate_content'
  | 'missing_h1'
  | 'page_speed_poor'
  | 'missing_alt_text'
  | 'no_sitemap'
  | 'keyword_gap_critical'
  | 'low_domain_rank'
  | 'keywords_not_configured'  // P8.5.19: no target keywords set up

export type AiVisibilityFindingType =
  | 'brand_not_mentioned'
  | 'low_ai_rank'
  | 'no_geo_directive'
  | 'geo_directive_outdated'
  | 'missing_faq_content'
  | 'insufficient_entity_coverage'
  | 'ai_visibility_not_tracked'  // P8.5.22: AI Tracker never ran for this client

export type AdsFindingType =
  | 'high_cpc'
  | 'low_quality_score'
  | 'missing_ad_extensions'
  | 'poor_landing_page_relevance'
  | 'budget_inefficiency'

export type SocialFindingType =
  | 'low_posting_frequency'
  | 'low_engagement_rate'
  | 'missing_platform_presence'
  | 'inconsistent_brand_voice'
  | 'no_content_calendar'
  | 'social_accounts_not_linked'  // P8.5.23: IG/FB handles not configured

export type ReputationFindingType =
  | 'negative_reviews'
  | 'low_review_rating'
  | 'missing_review_responses'
  | 'insufficient_review_count'
  | 'inconsistent_business_info'
  | 'no_review_platform'
  | 'business_not_listed'  // P8.5.20: no Google Business Profile found

export type CompetitorFindingType =
  | 'competitor_keyword_gap'
  | 'competitor_content_gap'
  | 'competitor_backlink_gap'
  | 'competitor_ranking_advantage'
  | 'market_share_loss'
  | 'traffic_gap_large'
  | 'no_competitor_data'
  | 'competitor_data_insufficient'  // P8.5.21: < 3 competitors detected

export type FindingType =
  | SeoFindingType
  | AiVisibilityFindingType
  | AdsFindingType
  | SocialFindingType
  | ReputationFindingType
  | CompetitorFindingType

// ── DiagnosticRun (§2.1) ──────────────────────────────────────────────────────

export type DiagnosticRunStatus = 'pending' | 'running' | 'completed' | 'failed'
export type DiagnosticTrigger = 'user' | 'cron' | 'onboarding'

export interface DiagnosticRun {
  id: string
  client_id: string
  triggered_by: DiagnosticTrigger
  status: DiagnosticRunStatus
  dimensions_requested: DiagnosticDimension[]
  /** P8.5.26: dimensions excluded from overall_score due to missing data */
  dimensions_skipped: DiagnosticDimension[]
  overall_score: number | null
  /** Score per dimension. `null` value = data not available (excluded from overall_score). */
  dimension_scores: Partial<Record<DiagnosticDimension, number | null>> | null
  findings_count: number
  critical_count: number
  high_count: number
  started_at: string | null
  completed_at: string | null
  error_message: string | null
  created_at: string
}

// ── DiagnosticFinding (§2.2) ──────────────────────────────────────────────────

export interface DiagnosticFinding {
  id: string
  run_id: string
  client_id: string
  dimension: DiagnosticDimension
  finding_type: FindingType
  severity: DiagnosticSeverity
  title: string
  description: string
  evidence: Record<string, unknown> | null
  recommendation: string
  fix_type: FixType
  priority_score: number
  created_at: string
}

// ── Prescription (§2.3) ───────────────────────────────────────────────────────

export type PrescriptionStatus = 'draft' | 'approved' | 'rejected' | 'superseded'

export interface Prescription {
  id: string
  client_id: string
  run_id: string
  status: PrescriptionStatus
  intake: PrescriptionIntake | null
  content: PrescriptionContent | null
  generated_at: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

// ── ExecutionItem (§2.4) ──────────────────────────────────────────────────────

export type ExecutionItemStatus = 'pending' | 'in_progress' | 'completed' | 'skipped'

export interface ExecutionItem {
  id: string
  prescription_id: string
  client_id: string
  finding_id: string | null
  dimension: DiagnosticDimension
  phase: number
  title: string
  description: string
  fix_type: FixType
  status: ExecutionItemStatus
  steps_json: Record<string, unknown> | null
  assigned_to: string | null
  due_date: string | null
  completed_at: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

// ── PrescriptionIntake (§4.1) ─────────────────────────────────────────────────

export type TimelineUrgency = 'immediate' | 'short_term' | 'long_term'

export interface PrescriptionIntake {
  business_goal: string
  timeline_urgency: TimelineUrgency
  monthly_budget_aud: number
  priority_dimensions: DiagnosticDimension[]
  notes: string | null
}

// ── PrescriptionContent (§4.3) ────────────────────────────────────────────────

export type EffortLevel = 'low' | 'medium' | 'high'

export interface PrescriptionAction {
  id: string
  title: string
  description: string
  dimension: DiagnosticDimension
  fix_type: FixType
  phase: number
  effort: EffortLevel
  impact: EffortLevel
  finding_ids: string[]
}

export interface PrescriptionPhase {
  phase_number: number
  name: string
  duration_weeks: number
  actions: PrescriptionAction[]
}

export interface KPITarget {
  metric: string
  current_value: number | null
  target_value: number
  unit: string
  dimension: DiagnosticDimension
}

export interface BudgetAllocationItem {
  dimension: DiagnosticDimension
  amount_aud: number
  percentage: number
}

export interface PrescriptionContent {
  summary: string
  phases: PrescriptionPhase[]
  kpi_targets: KPITarget[]
  budget_allocation: BudgetAllocationItem[]
}
