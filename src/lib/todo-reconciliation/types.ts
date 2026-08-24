/**
 * Todo Reconciliation Gate — WP1 (#1169).
 *
 * Shape for turning raw audited work rows (manual-lane items, cron failure
 * runs, execution cards, reel reviews, blog drafts, GBP setup tasks) into a
 * deterministic set of unresolved clusters + suppressed-with-reason groups,
 * before any of it reaches a human queue or a report.
 */

/**
 * Why an item was kept unresolved, or why it was suppressed. Every raw item
 * gets exactly one reason code — nothing disappears without one (CLAUDE.md
 * §3: 发现不许死在日志里).
 */
export type ReasonCode =
  // ── kept (still counts toward the unresolved total) ──────────────────────
  | 'GENUINE_UNRESOLVED'
  | 'HUMAN_DECISION_REQUIRED'
  | 'CHECK_FAILED_UNRESOLVED'
  // ── suppressed (removed from the unresolved total, but never silently) ───
  // Repeated occurrences of the SAME root cause (e.g. one cron job failing
  // 48 times) are not a suppression reason — they collapse into a single
  // kept cluster via `occurrenceCount`, so the real repeat count stays
  // visible instead of being hidden in a suppressed bucket.
  | 'INTENTIONAL_STATE'
  | 'NOT_YET_DUE'
  | 'CONNECTOR_ALREADY_CONNECTED'
  | 'DUPLICATE_WORK_ITEM'
  | 'TERMINAL_COMPLETED'
  | 'AUTO_EXECUTABLE_NOT_HUMAN_WORK'

export const KEPT_REASON_CODES: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  'GENUINE_UNRESOLVED',
  'HUMAN_DECISION_REQUIRED',
  'CHECK_FAILED_UNRESOLVED',
])

export type RawWorkItemSource =
  | 'manual_item'
  | 'cron_failure'
  | 'execution_card'
  | 'reel_review'
  | 'blog_draft'
  | 'gbp_setup'

export interface RawWorkItem {
  id: string
  source: RawWorkItemSource
  /** Fine-grained kind within `source`, e.g. 'url_indexing', 'dnc_ambiguity'. */
  category: string
  clientId: string | null
  clientName: string | null
  /**
   * Stable identity used to collapse repeats of the SAME underlying work
   * (a cron job's repeated failures, the same URL's repeated crawl rows,
   * the same reel across duplicate feeds) into one cluster. Two raw items
   * with the same rootCauseKey are the same piece of work, not two.
   */
  rootCauseKey: string
  label: string
  detail?: string
  /** ISO date. Required for ageing/same-day/terminal checks. */
  createdAt?: string
  /** SEO indexing verdict, only present for category === 'url_indexing'. */
  verdict?: string
  /** Only present for source === 'execution_card'. */
  fixType?: 'me_auto' | 'fde_manual'
  /** Only present for source === 'reel_review'. */
  reelStatus?: string
}

export interface ReconciledCluster {
  rootCauseKey: string
  source: RawWorkItemSource
  category: string
  clientName: string | null
  label: string
  /** How many raw rows collapsed into this one cluster. */
  occurrenceCount: number
  reason: ReasonCode
  itemIds: string[]
}

export interface SuppressedGroup {
  reason: ReasonCode
  count: number
  itemIds: string[]
  /** One representative label so a reviewer can eyeball what got dropped. */
  sample: string
}

export interface ReconciliationResult {
  asOf: string
  totalRaw: number
  unresolvedClusters: ReconciledCluster[]
  /** Sum of occurrenceCount across unresolvedClusters. */
  totalUnresolvedOccurrences: number
  suppressed: SuppressedGroup[]
  totalSuppressed: number
}
