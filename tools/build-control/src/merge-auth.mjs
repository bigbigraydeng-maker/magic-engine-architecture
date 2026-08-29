/**
 * `ME_MERGE_AUTH_V1` — exact-head merge authorisation.
 *
 * The whole point of naming the SHA inside the marker (rather than, say,
 * relying on "posted after the last push") is that a push automatically
 * invalidates the old authorisation: a marker for `sha=aaa` simply does not
 * match a PR whose head has moved to `sha=bbb`, with no separate revocation
 * step required and nothing to forget to do.
 *
 * A short SHA is refused, not truncated-matched: GitHub always reports full
 * 40-hex head SHAs from the API, so accepting a prefix here would only ever
 * widen what counts as a match, never narrow it usefully.
 */

export const MERGE_AUTH_MARKER = 'ME_MERGE_AUTH_V1'

const MARKER_RE = new RegExp(`<!--\\s*${MERGE_AUTH_MARKER}\\s*:\\s*(\\{[\\s\\S]*?\\})\\s*-->`, 'g')
const FULL_SHA_RE = /^[0-9a-f]{40}$/i

/**
 * @param {{ pr: number, headSha: string, authorizedBy: string, authorizedAt: string }} input
 * @returns {string}
 */
export function buildMergeAuthMarker({ pr, headSha, authorizedBy, authorizedAt }) {
  if (!FULL_SHA_RE.test(headSha)) {
    throw new Error(`refusing to build a merge-auth marker with a non-full SHA: "${headSha}"`)
  }
  const payload = { pr: Number(pr), head_sha: headSha.toLowerCase(), authorized_by: authorizedBy, authorized_at: authorizedAt }
  return `<!-- ${MERGE_AUTH_MARKER}: ${JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')} -->`
}

/**
 * @typedef {{ pr: number, head_sha: string, authorized_by: string, authorized_at: string }} MergeAuthRecord
 */

/**
 * @param {{ author: string | null | undefined, body: string | null | undefined }} comment
 * @returns {MergeAuthRecord[]}
 */
function parseFromBody(body) {
  if (typeof body !== 'string') return []
  /** @type {MergeAuthRecord[]} */
  const out = []
  for (const match of body.matchAll(MARKER_RE)) {
    let payload
    try {
      payload = JSON.parse(match[1])
    } catch {
      continue
    }
    if (!payload || typeof payload !== 'object') continue
    if (typeof payload.pr !== 'number') continue
    if (typeof payload.head_sha !== 'string' || !FULL_SHA_RE.test(payload.head_sha)) continue
    if (typeof payload.authorized_by !== 'string' || payload.authorized_by === '') continue
    if (typeof payload.authorized_at !== 'string') continue
    out.push({ ...payload, head_sha: payload.head_sha.toLowerCase() })
  }
  return out
}

/**
 * Reads valid `ME_MERGE_AUTH_V1` records from a set of comments, keeping only
 * ones authored by an allow-listed login — the same "provenance is a property
 * of where the text came from" reasoning as `tools/ops-review-loop/src/gate-marker.mjs`'s
 * `selectTrustedGateMarkers`: the marker's own escaping stops it being
 * corrupted, not authored by someone untrusted.
 *
 * @param {{ comments: Array<{ author?: string | null, body?: string | null }>, allowlist: Iterable<string> }} input
 * @returns {MergeAuthRecord[]}
 */
export function selectTrustedMergeAuthRecords({ comments, allowlist }) {
  const trusted = new Set([...allowlist].filter((login) => typeof login === 'string'))
  if (!Array.isArray(comments)) return []
  const out = []
  for (const comment of comments) {
    if (!comment || !trusted.has(comment.author)) continue
    out.push(...parseFromBody(comment.body))
  }
  return out
}

/**
 * Is there a valid, current authorisation for this exact PR head?
 *
 * "Current" means the newest trusted record for this PR number whose
 * `head_sha` exactly equals `currentHeadSha` — a push that lands a new SHA
 * makes every older record describe a PR state that no longer exists, with no
 * separate expiry bookkeeping needed.
 *
 * @param {{ records: MergeAuthRecord[], prNumber: number, currentHeadSha: string }} input
 * @returns {{ authorized: true, record: MergeAuthRecord } | { authorized: false, reason: string }}
 */
export function isMergeAuthorized({ records, prNumber, currentHeadSha }) {
  if (typeof currentHeadSha !== 'string' || !FULL_SHA_RE.test(currentHeadSha)) {
    return { authorized: false, reason: 'current PR head SHA is not a readable full SHA' }
  }
  const normalizedHead = currentHeadSha.toLowerCase()
  const matches = (Array.isArray(records) ? records : []).filter(
    (r) => r.pr === prNumber && r.head_sha === normalizedHead
  )
  if (matches.length === 0) {
    return {
      authorized: false,
      reason: `no trusted ${MERGE_AUTH_MARKER} record names PR #${prNumber} at head ${normalizedHead}`,
    }
  }
  // Newest wins, same "last one wins" rule as the rest of this repo's marker
  // readers — a later authorisation for the same exact head supersedes an
  // earlier one (e.g. a re-authorisation after a revert-and-restore lands the
  // same SHA twice).
  const newest = matches.reduce((a, b) => (Date.parse(b.authorized_at) >= Date.parse(a.authorized_at) ? b : a))
  return { authorized: true, record: newest }
}
