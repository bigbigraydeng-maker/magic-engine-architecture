/**
 * `ME_CAP_OVERRIDE_V1` — the narrowly authenticated escape hatch for the
 * recovery PR cap.
 *
 * A cap that cannot be lifted stops a genuine security or recovery fix during
 * exactly the backlog it was designed to punish, so the hatch has to exist.
 * What makes it narrow rather than a hole:
 *
 *   - authored by an allow-listed login, and the payload's own `granted_by`
 *     must agree with the actual comment author (a quoted grant is not a grant);
 *   - bound to one Primary Issue, so it cannot be reused for other work;
 *   - a non-empty reason, so the record says why;
 *   - a bounded expiry, so a forgotten override lapses on its own.
 *
 * It bypasses the cap and nothing else — duplicate-issue and required-contract
 * checks are unaffected, which is enforced by the callers in
 * `pr-admission.mjs` / `dispatch-preflight.mjs`, not here.
 */

import { findMarkers, serializeMarker } from './markers.mjs'

export const CAP_OVERRIDE_MARKER = 'ME_CAP_OVERRIDE_V1'

/** An override may not be granted for longer than this. */
export const MAX_OVERRIDE_WINDOW_MS = 72 * 60 * 60 * 1000

/**
 * @typedef {{ primary_issue: number, granted_by: string, reason: string, expires_at: string }} CapOverrideRecord
 */

/**
 * @param {CapOverrideRecord} record
 * @returns {string}
 */
export function buildCapOverrideMarker(record) {
  return serializeMarker(CAP_OVERRIDE_MARKER, record)
}

/**
 * @param {{
 *   comments: Array<{ author?: string | null, body?: string | null }>,
 *   allowlist: Iterable<string>,
 *   issueNumber: number,
 *   now: string | Date,
 * }} input
 * @returns {{ granted: true, record: CapOverrideRecord } | { granted: false, reason: string }}
 */
export function selectCapOverride({ comments, allowlist, issueNumber, now }) {
  const trusted = new Set([...(allowlist ?? [])].filter((login) => typeof login === 'string'))
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now))
  if (Number.isNaN(nowMs)) return { granted: false, reason: 'current time is unreadable — refusing to grant an override' }

  /** @type {CapOverrideRecord[]} */
  const valid = []
  /** @type {string[]} */
  const rejected = []

  for (const comment of Array.isArray(comments) ? comments : []) {
    if (!comment) continue
    const author = comment.author ?? null
    for (const payload of findMarkers(CAP_OVERRIDE_MARKER, comment.body)) {
      const problem = disqualify(payload, { author, trusted, issueNumber, nowMs })
      if (problem) rejected.push(problem)
      else valid.push(/** @type {CapOverrideRecord} */ (payload))
    }
  }

  if (valid.length === 0) {
    return {
      granted: false,
      reason:
        rejected.length > 0
          ? `no usable ${CAP_OVERRIDE_MARKER}: ${rejected.join('; ')}`
          : `no ${CAP_OVERRIDE_MARKER} was presented`,
    }
  }
  // Latest expiry wins — re-granting extends, it never shortens by accident.
  const record = valid.reduce((a, b) => (Date.parse(b.expires_at) >= Date.parse(a.expires_at) ? b : a))
  return { granted: true, record }
}

/**
 * @returns {string | null} why this payload cannot be used, or null if it can.
 */
function disqualify(payload, { author, trusted, issueNumber, nowMs }) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'payload is not an object'
  const { primary_issue: primaryIssue, granted_by: grantedBy, reason, expires_at: expiresAt } = payload

  if (!trusted.has(author)) return `author ${author ?? '(unattributed)'} is not on the override allowlist`
  if (grantedBy !== author) return `granted_by "${grantedBy}" does not match the comment author "${author}"`
  if (primaryIssue !== issueNumber) return `granted for Issue #${primaryIssue}, not #${issueNumber}`
  if (typeof reason !== 'string' || reason.trim() === '') return 'no reason was given'

  const expiryMs = typeof expiresAt === 'string' ? Date.parse(expiresAt) : NaN
  if (Number.isNaN(expiryMs)) return 'expires_at is missing or not a parseable timestamp'
  if (expiryMs <= nowMs) return `expired at ${expiresAt}`
  if (expiryMs - nowMs > MAX_OVERRIDE_WINDOW_MS) {
    return `expires_at is more than ${MAX_OVERRIDE_WINDOW_MS / 3600000}h away — refusing an unbounded override`
  }
  return null
}
