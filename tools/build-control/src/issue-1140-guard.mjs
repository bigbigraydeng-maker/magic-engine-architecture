/**
 * Pure decision function behind the #1140 strict-state guard.
 *
 * Important limitation, stated once here so it cannot be lost by omission
 * elsewhere: `chatgpt-codex-connector` has raw Issue-write permission today,
 * so nothing in this repository can *stop* it from posting an invalid
 * `ME_CONTROL_STATE_V1` comment — this guard can only detect an invalid
 * comment after the fact and leave a bounded, machine-visible signal. The
 * Obsidian consumer remains the fail-closed boundary that actually refuses to
 * *use* an incomplete payload; this guard does not replace it, and this
 * module does not edit or delete the source comment it is judging.
 */

import { findControlStateMarkers, validateControlState } from './control-state.mjs'

export const CONTROL_STATE_INVALID_LABEL = 'build-control:1140-state-invalid'

/**
 * @param {{ comments: Array<{ body: string, createdAt: string }>, maxFreshnessMs?: number }} input
 * @returns {
 *   | { status: 'NO_MARKER' }
 *   | { status: 'VALID', comment: { createdAt: string } }
 *   | { status: 'INVALID', comment: { createdAt: string }, reasons: string[] }
 * }
 */
export function evaluateControlStateGuard({ comments, maxFreshnessMs }) {
  const withMarkers = (Array.isArray(comments) ? comments : [])
    .map((comment) => ({ comment, markers: findControlStateMarkers(comment.body) }))
    .filter((entry) => entry.markers.length > 0)

  if (withMarkers.length === 0) return { status: 'NO_MARKER' }

  // Newest comment carrying a marker wins, same "last write wins" rule as
  // every other marker reader in this repository.
  const latest = withMarkers[withMarkers.length - 1]
  const latestMarker = latest.markers[latest.markers.length - 1]

  const result = validateControlState({
    payload: latestMarker,
    commentTimestamp: latest.comment.createdAt,
    ...(maxFreshnessMs !== undefined ? { maxFreshnessMs } : {}),
  })

  if (result.valid) {
    return { status: 'VALID', comment: { createdAt: latest.comment.createdAt } }
  }
  return { status: 'INVALID', comment: { createdAt: latest.comment.createdAt }, reasons: result.reasons }
}
