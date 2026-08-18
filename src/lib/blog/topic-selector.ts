/**
 * Blog Topic Selector — Dual-Signal Mode (degraded pending M1 re-wire).
 *
 * Previously read ai-tracker (system B) run history (`ai_visibility_queries` +
 * `ai_visibility_runs`) to find queries where the client brand was consistently
 * weak in AI answers, then enriched each with DataForSEO keyword data to pick
 * blog topics.
 *
 * ai-tracker was decommissioned (spec 2026-08-19-ai-tracker-decommission-v1.md,
 * 组 H). There is no per-client AI run history to derive weak spots from until
 * the unified GEO measurement (M1) exposes an equivalent signal + a living query
 * set (P31.X.4, spec §9.2). Until then this returns no opportunities, so callers
 * (weekly-blog, blog/opportunities) fall back to "skipped_no_topic" — the same
 * behaviour as a client that had no tracked queries before.
 *
 * Reference: ROADMAP.md P31.X.4
 */

import type { BlogOpportunity } from '@/types/magic-engine'

/**
 * Return blog topic opportunities derived from AI weak spots.
 *
 * Degraded to always return `[]` while AI visibility is being migrated to M1
 * (P31.X.4). Signature preserved for callers.
 */
export async function getWeakSpotOpportunities(
  _clientId: string,
  _limit = 20,
  _lookback = 10,
  _includeSemrush = true
): Promise<BlogOpportunity[]> {
  return []
}
