/**
 * Strict-state guard for the `ME_CONTROL_STATE_V1` marker on Issue #1140.
 *
 * Documented limitation, stated here so it cannot be lost by omission:
 * `chatgpt-codex-connector` holds raw Issue-write permission, so nothing in
 * this repository can *stop* an invalid or untrusted state comment from being
 * posted. This guard detects it and leaves a bounded, machine-visible signal;
 * the existing Obsidian consumer remains the fail-closed boundary that refuses
 * to *use* a payload. This module never edits or deletes the comment it judges.
 *
 * Provenance is explicit: canonical state is the newest marked comment from an
 * allow-listed writer. If the newest marked comment overall came from anyone
 * else it is reported `UNTRUSTED` — never silently promoted to canonical, and
 * never silently ignored either.
 */

import { findControlStateMarkers, validateControlState } from './control-state.mjs'

export const CONTROL_STATE_INVALID_LABEL = 'build-control:1140-state-invalid'

/**
 * @typedef {{ createdAt: string, author: string | null }} StateComment
 * @typedef {{ status: 'NO_MARKER' }} NoMarker
 * @typedef {{ status: 'VALID', comment: StateComment }} StateValid
 * @typedef {{ status: 'UNTRUSTED', comment: StateComment, reasons: string[] }} StateUntrusted
 * @typedef {{ status: 'INVALID', comment: StateComment, reasons: string[] }} StateInvalid
 */

/**
 * @param {{
 *   comments: Array<{ author?: string | null, body: string, createdAt: string }>,
 *   writerAllowlist: Iterable<string>,
 *   maxFreshnessMs?: number,
 * }} input
 * @returns {NoMarker | StateValid | StateUntrusted | StateInvalid}
 */
export function evaluateControlStateGuard({ comments, writerAllowlist, maxFreshnessMs }) {
  const trusted = new Set([...(writerAllowlist ?? [])].filter((login) => typeof login === 'string'))
  const marked = (Array.isArray(comments) ? comments : [])
    .map((comment) => ({ comment, markers: findControlStateMarkers(comment.body) }))
    .filter((entry) => entry.markers.length > 0)

  if (marked.length === 0) return { status: 'NO_MARKER' }

  const newest = marked[marked.length - 1]
  const author = newest.comment.author ?? null
  const at = { createdAt: newest.comment.createdAt, author }

  if (!trusted.has(author)) {
    return {
      status: 'UNTRUSTED',
      comment: at,
      reasons: [
        `the newest ${author === null ? 'unattributed' : `\`${author}\``} state comment is not from an ` +
          'allow-listed state writer, so it must not be treated as canonical portfolio state',
      ],
    }
  }

  // Last write wins among trusted writers, same rule as every other marker
  // reader here.
  const payload = newest.markers[newest.markers.length - 1]
  const result = validateControlState({
    payload,
    commentTimestamp: newest.comment.createdAt,
    ...(maxFreshnessMs !== undefined ? { maxFreshnessMs } : {}),
  })

  return result.valid ? { status: 'VALID', comment: at } : { status: 'INVALID', comment: at, reasons: result.reasons }
}
