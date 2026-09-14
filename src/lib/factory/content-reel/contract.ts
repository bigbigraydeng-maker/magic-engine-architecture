/**
 * Content Reel publish — data-layer contract (PR-A).
 *
 * Mirrors supabase/migrations/20260915140000_content_reel_publish_attempts.sql so the
 * application layer (PR-C) never re-types state names, legal transitions or RPC
 * refusal codes by hand. The database is the enforcement point; this module is only
 * the typed vocabulary. `contract.test.ts` reads the migration and fails when the two
 * drift apart.
 *
 * No runtime caller yet — intentionally. See spec
 * docs/specs/2026-09-15-creatomate-reel-publish-spec-v2.md (v2.1 §3, §14).
 */

export const CONTENT_REEL_ACTIVE_STATES = ['authorized', 'claimed', 'uploading', 'in_doubt'] as const

export const CONTENT_REEL_STATES = [
  ...CONTENT_REEL_ACTIVE_STATES,
  'cancelled',
  'preflight_failed',
  'not_on_facebook',
  'draft_published',
  'draft_deleted',
  'published',
  'removed_externally',
] as const

export type ContentReelState = (typeof CONTENT_REEL_STATES)[number]
export type ContentReelActiveState = (typeof CONTENT_REEL_ACTIVE_STATES)[number]

/** Legal (from, to) pairs, identical to public.content_reel_transition_allowed(). */
export const CONTENT_REEL_TRANSITIONS: ReadonlyArray<readonly [ContentReelState, ContentReelState]> = [
  ['authorized', 'claimed'],
  ['authorized', 'cancelled'],
  ['authorized', 'preflight_failed'],
  ['claimed', 'claimed'],
  ['claimed', 'uploading'],
  ['claimed', 'preflight_failed'],
  ['claimed', 'not_on_facebook'],
  ['uploading', 'uploading'],
  ['uploading', 'published'],
  ['uploading', 'draft_published'],
  ['uploading', 'in_doubt'],
  ['in_doubt', 'in_doubt'],
  ['in_doubt', 'published'],
  ['in_doubt', 'draft_published'],
  ['in_doubt', 'not_on_facebook'],
  ['published', 'published'],
  ['published', 'removed_externally'],
  ['published', 'in_doubt'],
  ['draft_published', 'draft_published'],
  ['draft_published', 'draft_deleted'],
  ['not_on_facebook', 'published'],
]

export function isContentReelTransitionAllowed(from: ContentReelState, to: ContentReelState): boolean {
  return CONTENT_REEL_TRANSITIONS.some(([f, t]) => f === from && t === to)
}

/**
 * Keys accepted by content_reel_transition(p_patch). Marker keys (touch_* / mark_* /
 * clear_*) take `true` and are stamped with the database clock — callers can never
 * supply the timestamps that gate absence-based transitions.
 */
export const CONTENT_REEL_PATCH_VALUE_KEYS = [
  'video_id',
  'video_state',
  'permalink',
  'published_at',
  'publish_confirmation',
  'publish_confirmed_by_user_id',
  'env_live_at_publish',
  'rules_live_at_publish',
  'error_code',
  'error_detail',
  'alert_code',
  'first_comment_state',
  'first_comment_verification_basis',
  'provider_impact',
] as const

export const CONTENT_REEL_PATCH_MARKER_KEYS = [
  'touch_last_step',
  'mark_absence',
  'clear_absence',
  'mark_video_deleted',
  'mark_publish_verified',
  'mark_first_comment_verified',
] as const

export const CONTENT_REEL_FOLLOWUP_KEYS = [
  'books_written',
  'published_event_ids',
  'measurement_registered',
  'draft_delete_results',
  'last_error',
] as const

/** Codes returned as `{ ok: false, code }` (never thrown) by the RPCs. */
export const CONTENT_REEL_RPC_REFUSAL_CODES = [
  // content_reel_video_copy_start / _finish
  'copy_id_reused',
  'post_not_found',
  'copy_not_found',
  'copy_already_finalized',
  // content_reel_authorize
  'authorization_id_reused',
  'post_state_changed',
  'video_copy_mismatch',
  'video_copy_not_ready',
  'video_changed_since_prepare',
  'render_in_progress',
  'active_attempt_exists',
  'post_already_published',
  'duplicate_content_hash',
  // content_reel_transition (soft guard refusals + lock outcome)
  'attempt_not_found',
  'transition_lost',
  'claimed_too_recent',
  'not_on_facebook_requires_deletion',
  'absence_not_confirmed_twice',
  'last_write_too_recent',
  'draft_deleted_requires_deletion',
  // content_reel_mark_post_published / abandon_post
  'attempt_not_published',
  'drafts_not_deleted',
  // set_content_reel_live_enabled
  'client_not_found',
  'stale',
] as const

export type ContentReelRpcRefusalCode = (typeof CONTENT_REEL_RPC_REFUSAL_CODES)[number]

/** Timing floors enforced in SQL (minutes). Spec v2.1 §3.2. */
export const CONTENT_REEL_TIMING_MINUTES = {
  /** start 60s timeout + margin, for a claimed attempt that never got a video_id */
  claimedWithoutVideo: 5,
  /** start 1 + rupload 15 + finish 1 = 17 minutes of bounded Graph writes, + 13 margin */
  lastWriteBeforeAbsence: 30,
  /** minimum age of the first absence evidence before the second one is accepted */
  absenceConfirmationGap: 10,
} as const

/** Same-content re-publish window (PM business window, spec §9, pending confirmation). */
export const CONTENT_REEL_DUPLICATE_HASH_WINDOW_DAYS = 30
