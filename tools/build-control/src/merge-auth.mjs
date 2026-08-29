/**
 * `ME_MERGE_AUTH_V1` — exact-head merge authorisation.
 *
 * Naming the SHA inside the marker is what makes a push self-revoking: a
 * marker for `sha=aaa` simply does not match a PR whose head has moved to
 * `sha=bbb`, so there is no separate revocation step to forget. A short SHA
 * is refused rather than prefix-matched — GitHub always reports full 40-hex
 * head SHAs, so accepting a prefix could only ever widen what matches.
 *
 * Provenance is bound twice: the comment author must be allow-listed, *and*
 * the payload's `authorized_by` must be that same author. Otherwise anyone
 * quoting an owner's marker back into their own comment would be re-issuing
 * the owner's authorisation.
 */

import { findMarkers, serializeMarker } from './markers.mjs'

export const MERGE_AUTH_MARKER = 'ME_MERGE_AUTH_V1'

const FULL_SHA_RE = /^[0-9a-f]{40}$/i

/**
 * @typedef {{ pr: number, head_sha: string, authorized_by: string, authorized_at: string }} MergeAuthRecord
 */

/**
 * @param {{ pr: number, headSha: string, authorizedBy: string, authorizedAt: string }} input
 * @returns {string}
 */
export function buildMergeAuthMarker({ pr, headSha, authorizedBy, authorizedAt }) {
  if (!FULL_SHA_RE.test(headSha)) {
    throw new Error(`refusing to build a merge-auth marker with a non-full SHA: "${headSha}"`)
  }
  return serializeMarker(MERGE_AUTH_MARKER, {
    pr: Number(pr),
    head_sha: headSha.toLowerCase(),
    authorized_by: authorizedBy,
    authorized_at: authorizedAt,
  })
}

/**
 * @param {{ comments: Array<{ author?: string | null, body?: string | null }>, allowlist: Iterable<string> }} input
 * @returns {MergeAuthRecord[]}
 */
export function selectTrustedMergeAuthRecords({ comments, allowlist }) {
  const trusted = new Set([...(allowlist ?? [])].filter((login) => typeof login === 'string'))
  /** @type {MergeAuthRecord[]} */
  const out = []
  for (const comment of Array.isArray(comments) ? comments : []) {
    const author = comment?.author ?? null
    if (!trusted.has(author)) continue
    for (const payload of findMarkers(MERGE_AUTH_MARKER, comment.body)) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue
      const { pr, head_sha: headSha, authorized_by: authorizedBy, authorized_at: authorizedAt } = payload
      if (typeof pr !== 'number') continue
      if (typeof headSha !== 'string' || !FULL_SHA_RE.test(headSha)) continue
      if (authorizedBy !== author) continue
      if (typeof authorizedAt !== 'string' || Number.isNaN(Date.parse(authorizedAt))) continue
      out.push({ pr, head_sha: headSha.toLowerCase(), authorized_by: authorizedBy, authorized_at: authorizedAt })
    }
  }
  return out
}

/**
 * Is there a valid authorisation for this exact PR head? "This exact head"
 * is the whole test: a push that lands a new SHA makes every older record
 * describe a PR state that no longer exists.
 *
 * @param {{ records: MergeAuthRecord[], prNumber: number, currentHeadSha: string }} input
 * @returns {{ authorized: true, record: MergeAuthRecord } | { authorized: false, reason: string }}
 */
export function isMergeAuthorized({ records, prNumber, currentHeadSha }) {
  if (typeof currentHeadSha !== 'string' || !FULL_SHA_RE.test(currentHeadSha)) {
    return { authorized: false, reason: 'current PR head SHA is not a readable full SHA' }
  }
  const head = currentHeadSha.toLowerCase()
  const matches = (Array.isArray(records) ? records : []).filter((r) => r.pr === prNumber && r.head_sha === head)
  if (matches.length === 0) {
    return {
      authorized: false,
      reason: `no trusted ${MERGE_AUTH_MARKER} record names PR #${prNumber} at head ${head}`,
    }
  }
  // Newest wins — a re-authorisation for the same exact head supersedes an
  // earlier one.
  const newest = matches.reduce((a, b) => (Date.parse(b.authorized_at) >= Date.parse(a.authorized_at) ? b : a))
  return { authorized: true, record: newest }
}
