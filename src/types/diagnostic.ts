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

export type AiVisibilityFindingType =
  | 'brand_not_mentioned'
  | 'low_ai_rank'
  | 'no_geo_directive'
  | 'geo_directive_outdated'
  | 'missing_faq_content'
  | 'insufficient_entity_coverage'

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

export type ReputationFindingType =
  | 'negative_reviews'
  | 'low_review_rating'
  | 'missing_review_responses'
  | 'insufficient_review_count'
  | 'inconsistent_business_info'

export type CompetitorFindingType =
  | 'competitor_keyword_gap'
  | 'competitor_content_gap'
  | 'competitor_backlink_gap'
  | 'competitor_ranking_advantage'
  | 'market_share_loss'

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
  overall_score: number | null
  dimension_scores: Partial<Record<DiagnosticDimension, number>> | null
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

export type PrescriptionStatus = 'draft' | 'active' | 'completed' | 'archived'

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
  title: string
  description: string
  fix_type: FixType
  status: ExecutionItemStatus
  assigned_to: string | null
  due_date: string | null
  completed_at: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

// ── PrescriptionIntake (§4.1) ─────────────────────────────────────────────────

export type BudgetRange = 'minimal' | 'moderate' | 'significant' | 'unlimited'

export interface PrescriptionIntake {
  client_goals: string[]
  budget_range: BudgetRange | null
  timeline_weeks: number | null
  priority_dimensions: DiagnosticDimension[]
  existing_resources: string[]
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

export interface PrescriptionContent {
  summary: string
  phases: PrescriptionPhase[]
  kpi_targets: KPITarget[]
}
