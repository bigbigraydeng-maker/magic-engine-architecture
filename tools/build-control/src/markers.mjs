/**
 * Inline `<!-- NAMESPACE: {json} -->` markers, the convention already used by
 * `tools/ops-review-loop/src/gate-marker.mjs`. Shared here so merge-auth,
 * outcome-receipt and cap-override cannot drift apart in how they escape or
 * find a payload.
 *
 * `ME_CONTROL_STATE_V1` deliberately does **not** use this shape — its format
 * is fixed by the Issue #1140 consumer, see `control-state.mjs`.
 */

/**
 * @param {string} namespace
 * @param {unknown} payload
 * @returns {string}
 */
export function serializeMarker(namespace, payload) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  return `<!-- ${namespace}: ${json} -->`
}

/**
 * Every payload carrying `namespace` in `body`, parsed. Malformed JSON is
 * skipped rather than thrown on — one corrupted comment must not make a whole
 * read fail.
 *
 * @param {string} namespace
 * @param {string|null|undefined} body
 * @returns {unknown[]}
 */
export function findMarkers(namespace, body) {
  if (typeof body !== 'string') return []
  const re = new RegExp(`<!--\\s*${namespace}\\s*:\\s*(\\{[\\s\\S]*?\\})\\s*-->`, 'g')
  /** @type {unknown[]} */
  const out = []
  for (const match of body.matchAll(re)) {
    try {
      out.push(JSON.parse(match[1]))
    } catch {
      // skip
    }
  }
  return out
}
