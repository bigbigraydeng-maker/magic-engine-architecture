/**
 * 三代理复盘引擎 — 类型定义（P8.10.S6）
 *
 * 复盘报告由 Claude 基于「原诊断 + 处方 KPI + 执行进度 + 工作日志」综合产出。
 * S6.1 MVP：不重跑张骞，而是站在三代理（张骞/华佗/鲁班）视角对现状做结构化复盘。
 * S6.2（未来）：接入张骞重新诊断，做真实前后对比。
 */

import type { DiagnosticDimension } from '@/types/diagnostic'

/** 项目进度健康度 */
export type ProgressHealth = 'on_track' | 'at_risk' | 'off_track'

/** 单维度复盘 */
export interface DimensionReview {
  dimension: DiagnosticDimension
  /** good=进展良好 / lagging=滞后 / not_started=尚未启动 */
  status: 'good' | 'lagging' | 'not_started'
  comment: string
}

/** 单个 KPI 复盘 */
export interface KpiReview {
  metric: string
  target: string
  /** 鲁班基于执行进度对当前实际值的估计（无数据则写「待度量」） */
  current_estimate: string
  on_track: boolean
  comment: string
}

/** 复盘建议项 */
export interface ReviewRecommendation {
  priority: 'high' | 'medium' | 'low'
  action: string
  rationale: string
  /** 是否需要回到华佗处方层处理（补充/修订处方） */
  needs_prescription_change: boolean
}

/**
 * 复盘报告正文 — 持久化进 project_reviews.content。
 */
export interface ProjectReviewContent {
  /** 整体评估叙述（中文，3-5 句） */
  overall_assessment: string
  /** 进度健康度 */
  progress_health: ProgressHealth
  /** 时间线判断：进度对得上预期吗 */
  timeline_verdict: string
  /** 六大维度逐项复盘 */
  dimension_review: DimensionReview[]
  /** 处方 KPI 逐项复盘 */
  kpi_review: KpiReview[]
  /** 识别出的卡点 */
  blockers: string[]
  /** 优先级排序的下一步建议 */
  recommendations: ReviewRecommendation[]
  /** 下次复盘时机建议 */
  next_review_suggestion: string
}

/** 复盘运行的元数据 — 持久化进 project_reviews.meta */
export interface ProjectReviewMeta {
  input_tokens: number
  output_tokens: number
  cost_usd: number
  /** 复盘时项目快照 */
  snapshot: {
    prescription_count: number
    execution_item_count: number
    completed_count: number
    project_age_days: number | null
  }
}

export type ProjectReviewStatus = 'generating' | 'completed' | 'failed'

export interface ProjectReview {
  id: string
  client_id: string
  status: ProjectReviewStatus
  summary: string | null
  content: ProjectReviewContent | null
  meta: ProjectReviewMeta | null
  error_message: string | null
  created_at: string
}
