/**
 * The machine-readable half of the dev gate: one hidden HTML comment per
 * rating, carrying the level, the two shas it was computed from, and the
 * reasons.
 *
 *   <!-- me-dev-gate:{"v":1,"base":"<sha>","head":"<sha>","risk":"A","reasons":["..."]} -->
 *
 * 🔴 **Why the rating is bound to a pair of shas.**
 *
 * A rating describes a diff, and a diff is `base..head`. Carrying only the head
 * would make a rating look valid after a rebase or a base-branch merge changed
 * what the diff contains; carrying only the base would make it survive the very
 * push it is supposed to re-trigger on. Both are in the payload, and
 * `isGateCurrent` requires both to match — so the Product Owner's rule ("head
 * 一动，旧评级、旧质量分和旧 Codex 批准立即失效") is a comparison, not a habit.
 *
 * 🔴 **Why the payload is escaped before it is embedded.**
 *
 * The reasons are built from `risk.mjs`'s own table today, but they contain
 * file paths taken from the PR, and this string is embedded in an HTML comment.
 * A path containing `-->` would close the comment early and leave the rest of
 * the payload rendered as visible PR text — a marker that reads as valid to a
 * human while parsing as something else, or not at all. So every `<` and `>` in
 * the serialised JSON is written as a `\u003c` / `\u003e` escape (legal JSON,
 * decoded transparently by `JSON.parse`, and structurally impossible inside an
 * HTML comment delimiter), and the builder verifies the finished marker
 * round-trips before returning it. Same reasoning as `output.mjs`: if the
 * transport is forgeable, escaping the payload's *contents* fixes nothing.
 *
 * This module deliberately does not extend `markers.mjs`. That module's
 * `stage=/pr=/sha=` markers are the *loop's* state ledger and are matched by a
 * strict regex; this is a *rating record* with a structured payload. One regex
 * serving both would have to loosen to fit, and the loosened one is the one
 * that decides whether an automated push happens.
 */

/** Payload schema version. Bump only with a parser that still reads v1. */
export const GATE_MARKER_VERSION = 1

/**
 * @typedef {object} GateRecord
 * @property {number} v
 * @property {string} base
 * @property {string} head
 * @property {string} risk
 * @property {string[]} reasons
 * @property {number} [score]
 * @property {string} [decision]
 */

const MARKER_RE = /<!--\s*me-dev-gate:(\{[^]*?\})\s*-->/g

/**
 * Serialise the payload so it can never contain an HTML comment delimiter.
 *
 * `<` and `>` are not JSON structural characters, so replacing every one of
 * them with its `\uXXXX` escape changes no parse result — it only removes the
 * two characters an HTML comment could end on.
 *
 * @param {object} payload
 * @returns {string}
 */
function serialisePayload(payload) {
  return JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
}

/**
 * Build one gate marker.
 *
 * @param {{base: string, head: string, risk: string, reasons?: string[], score?: number|null, decision?: string|null}} input
 * @returns {string}
 * @throws if the marker does not survive its own parser
 */
export function buildGateMarker({ base, head, risk, reasons = [], score = null, decision = null }) {
  const payload = {
    v: GATE_MARKER_VERSION,
    base: String(base),
    head: String(head),
    risk: String(risk),
    reasons: (Array.isArray(reasons) ? reasons : []).map((r) => String(r)),
  }
  // Optional, and omitted rather than nulled when absent: a `"score":null` in
  // the record reads like "we measured zero", which is a different claim from
  // "we did not measure".
  if (Number.isFinite(score)) payload.score = score
  if (typeof decision === 'string' && decision !== '') payload.decision = decision

  const marker = `<!-- me-dev-gate:${serialisePayload(payload)} -->`

  // Prove it, do not assume it. The escaping above is the whole defence, and a
  // defence nobody checks is a defence that stops working the day someone edits
  // the serialiser.
  const [roundTripped] = parseGateMarkers([marker])
  if (!roundTripped || roundTripped.head !== payload.head || roundTripped.risk !== payload.risk) {
    throw new Error('refusing to emit a gate marker that does not survive its own parser')
  }
  return marker
}

/**
 * Read every gate marker out of a set of comment bodies, newest last (input
 * order is preserved).
 *
 * Malformed payloads are skipped, not thrown on: one corrupted comment must not
 * make the whole PR unreadable. A caller that finds no *valid* marker is in the
 * "no rating on record" state, which every gate here already treats as blocking.
 *
 * @param {Array<string|null|undefined>|unknown} bodies
 * @returns {GateRecord[]}
 */
export function parseGateMarkers(bodies) {
  const out = []
  for (const body of Array.isArray(bodies) ? bodies : []) {
    if (typeof body !== 'string') continue
    for (const match of body.matchAll(MARKER_RE)) {
      let payload
      try {
        payload = JSON.parse(match[1])
      } catch {
        continue
      }
      if (!payload || typeof payload !== 'object') continue
      if (payload.v !== GATE_MARKER_VERSION) continue
      if (typeof payload.base !== 'string' || typeof payload.head !== 'string') continue
      if (typeof payload.risk !== 'string') continue
      out.push({
        ...payload,
        reasons: Array.isArray(payload.reasons) ? payload.reasons.filter((r) => typeof r === 'string') : [],
      })
    }
  }
  return out
}

/**
 * Is this rating still describing the PR as it stands?
 *
 * @param {{base: string, head: string}|null|undefined} gate
 * @param {{base: string, head: string}|null|undefined} current
 * @returns {boolean}
 */
export function isGateCurrent(gate, current) {
  if (!gate || !current) return false
  return gate.base === current.base && gate.head === current.head
}

/**
 * The rating in force for `base..head`, or `null`.
 *
 * Last match wins: a re-rating posted later for the same pair supersedes an
 * earlier one, which is what a manual re-run of the gate is supposed to do.
 *
 * @param {{markers: GateRecord[]|unknown, base: string, head: string}} input
 * @returns {GateRecord|null}
 */
export function findGateFor({ markers, base, head }) {
  const matches = (Array.isArray(markers) ? markers : []).filter((m) => isGateCurrent(m, { base, head }))
  return matches.length === 0 ? null : matches[matches.length - 1]
}
