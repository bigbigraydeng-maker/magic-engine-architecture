/**
 * `ME_CONTROL_STATE_V1` — the portfolio-state marker Issue #1140 consumes.
 *
 * Two related bugs this module exists to close:
 *
 * 1. The Obsidian consumer already rejects an incomplete payload, but nothing
 *    stops a writer from *publishing* one under the same schema-version
 *    string. So `schema_version` cannot be trusted as a completeness signal —
 *    completeness here is always recomputed from which required keys are
 *    actually present, never read off a self-declared flag in the payload.
 * 2. A stale snapshot with a valid shape is still wrong: `updated_at` must
 *    both parse and sit within a bounded window of when the comment carrying
 *    it was actually posted, or a portfolio view from hours/days ago reads as
 *    current.
 */

export const CONTROL_STATE_MARKER = 'ME_CONTROL_STATE_V1'

export const REQUIRED_FIELDS = [
  'schema_version',
  'updated_at',
  'summary',
  'current_p0',
  'portfolio_p0',
  'product_capabilities',
  'customer_loops',
  'active_lanes',
  'ray_needed',
  'bottleneck',
]

/** Default bound: a control-state snapshot must be posted within this many ms
 * of its own `updated_at` claim. Six hours — generous enough for a snapshot
 * assembled from data pulled shortly before posting, tight enough to catch a
 * comment recycled from a much older run. */
export const DEFAULT_MAX_FRESHNESS_MS = 6 * 60 * 60 * 1000

const MARKER_RE = new RegExp(`<!--\\s*${CONTROL_STATE_MARKER}\\s*:\\s*(\\{[\\s\\S]*?\\})\\s*-->`, 'g')

/**
 * @param {string} payload
 * @returns {string}
 */
export function serializeControlState(payload) {
  return `<!-- ${CONTROL_STATE_MARKER}: ${JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')} -->`
}

/**
 * Every `ME_CONTROL_STATE_V1` marker found in a comment body, parsed and
 * unvalidated. Malformed JSON is skipped rather than thrown on — a single
 * corrupted comment must not make the whole read fail.
 *
 * @param {string|null|undefined} body
 * @returns {unknown[]}
 */
export function findControlStateMarkers(body) {
  if (typeof body !== 'string') return []
  const out = []
  for (const match of body.matchAll(MARKER_RE)) {
    try {
      out.push(JSON.parse(match[1]))
    } catch {
      // skip
    }
  }
  return out
}

/**
 * @param {unknown} payload
 * @returns {string[]} the required fields missing from the payload (key
 *   absent — a present key whose value is the string "UNKNOWN" still counts
 *   as present).
 */
export function missingRequiredFields(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [...REQUIRED_FIELDS]
  return REQUIRED_FIELDS.filter((field) => !(field in /** @type {Record<string, unknown>} */ (payload)))
}

/**
 * @param {unknown} updatedAt
 * @returns {number | null} epoch ms, or null if unparseable
 */
function parseUpdatedAt(updatedAt) {
  if (typeof updatedAt !== 'string' || updatedAt.trim() === '') return null
  const ms = Date.parse(updatedAt)
  return Number.isNaN(ms) ? null : ms
}

/**
 * @param {{ payload: unknown, commentTimestamp: string | Date, maxFreshnessMs?: number }} input
 * @returns {{
 *   valid: boolean,
 *   reasons: string[],
 *   missingFields: string[],
 *   updatedAtParsed: boolean,
 *   fresh: boolean | null,
 * }}
 */
export function validateControlState({ payload, commentTimestamp, maxFreshnessMs = DEFAULT_MAX_FRESHNESS_MS }) {
  const reasons = []
  const missingFields = missingRequiredFields(payload)
  if (missingFields.length > 0) {
    reasons.push(`missing required field(s): ${missingFields.join(', ')}`)
  }

  const record = payload && typeof payload === 'object' ? /** @type {Record<string, unknown>} */ (payload) : {}
  const updatedAtMs = parseUpdatedAt(record.updated_at)
  const updatedAtParsed = updatedAtMs !== null
  if (!updatedAtParsed) {
    reasons.push('updated_at is missing or not a parseable timestamp')
  }

  let fresh = null
  if (updatedAtParsed) {
    const commentMs =
      commentTimestamp instanceof Date ? commentTimestamp.getTime() : Date.parse(String(commentTimestamp))
    if (Number.isNaN(commentMs)) {
      reasons.push('comment timestamp is not parseable — cannot bound freshness')
      fresh = false
    } else {
      const age = Math.abs(commentMs - /** @type {number} */ (updatedAtMs))
      fresh = age <= maxFreshnessMs
      if (!fresh) {
        reasons.push(
          `updated_at is ${Math.round(age / 60000)} minutes away from the comment timestamp, ` +
            `exceeding the ${Math.round(maxFreshnessMs / 60000)}-minute bound`
        )
      }
    }
  }

  return {
    valid: missingFields.length === 0 && updatedAtParsed && fresh === true,
    reasons,
    missingFields,
    updatedAtParsed,
    fresh,
  }
}
