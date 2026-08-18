/**
 * Zhangqian → AI Visibility bridge (disabled pending M1 living query set).
 *
 * When a Zhangqian discovery was confirmed, this mirrored its
 * `ai_tracker_questions` into `ai_visibility_queries` so the AI Visibility
 * module had client-specific, high-signal tracking questions out of the box
 * (the discovery flow's "living" side: it kept appending newly-discovered
 * high-signal questions over time).
 *
 * ai-tracker (system B) is decommissioned (spec
 * 2026-08-19-ai-tracker-decommission-v1.md, 组 J). The `ai_visibility_queries`
 * write target is gone, and M1's query-set is a "frozen-once, DB-trigger-locked"
 * immutable model (geo-baseline freeze contract #883/#917) — it has NO
 * equivalent of Zhangqian's "keep appending as you discover" semantics yet.
 *
 * 🔴 This + the deleted `question-generator.ts` were the ONLY mechanism for
 * building/growing per-client tracking questions. Restoring it requires M1 to
 * gain a **living query set** capability (controlled append + lineage, isolated
 * from the frozen baseline). That is explicitly scoped to P31.X.4 (spec §9.2);
 * the archived 102 CTS questions (docs/clients/cts/ai-tracker-archive-2026-08-19)
 * are the intended seed. Until then this is a no-op so discovery confirmation
 * still succeeds — it just persists no tracking questions.
 *
 * Reference: ROADMAP.md P31.X.4
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DiscoveryReport } from './types'

/**
 * No-op bridge (see file header). Returns 0 — no questions persisted until the
 * M1 living query set lands (P31.X.4). Signature preserved for the confirm route.
 */
export async function syncAiTrackerQuestions(
  _supabase: SupabaseClient,
  _clientId: string,
  _payload: DiscoveryReport,
): Promise<number> {
  return 0
}
