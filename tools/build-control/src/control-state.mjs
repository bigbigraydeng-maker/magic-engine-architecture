/**
 * `ME_CONTROL_STATE_V1` — the portfolio-state marker Issue #1140 consumes.
 *
 * The format is **not** ours to choose: the real comments the existing
 * consumer reads carry a standalone marker line followed by a fenced JSON
 * object —
 *
 *     <!-- ME_CONTROL_STATE_V1 -->
 *     ```json
 *     { ... }
 *     ```
 *
 * — so that is the only shape parsed here. An inline
 * `<!-- ME_CONTROL_STATE_V1: {...} -->` payload is rejected on purpose:
 * validating a format the consumer cannot consume would report a state as
 * healthy that the consumer never sees.
 *
 * Two things the schema itself has to close:
 *
 * 1. `schema_version` is not a completeness signal. Nothing stops a writer
 *    from publishing a hollow payload under the same version string, so every
 *    required field is type-checked here rather than inferred from the
 *    version. An all-null payload fails.
 * 2. A stale snapshot with a valid shape is still wrong, so `updated_at` must
 *    parse and sit within a bounded window of when the comment carrying it
 *    was posted.
 *
 * `UNKNOWN` stays legal *inside* otherwise well-typed fields (an honest "we
 * do not know yet" is not the same as an absent field), but it can never
 * stand in for the field's container type.
 */

export const CONTROL_STATE_MARKER = 'ME_CONTROL_STATE_V1'

/** Default bound: a snapshot must be posted within six hours of its own
 * `updated_at` claim — generous enough for data pulled shortly before
 * posting, tight enough to catch a comment recycled from an older run. */
export const DEFAULT_MAX_FRESHNESS_MS = 6 * 60 * 60 * 1000

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const nonEmptyString = (v) => (typeof v === 'string' && v.trim() !== '' ? null : 'must be a non-empty string')
const nonEmptyObject = (v) =>
  isPlainObject(v) && Object.keys(v).length > 0 ? null : 'must be a non-empty object'
const array = (v) => (Array.isArray(v) ? null : 'must be an array')
const nonEmptyArray = (v) => (Array.isArray(v) && v.length > 0 ? null : 'must be a non-empty array')

/**
 * Field -> predicate returning `null` when valid or a reason when not.
 * `updated_at` is checked separately because it also needs the comment
 * timestamp. `active_lanes` and `ray_needed` may legitimately be empty (no
 * lane running, nothing needed from the owner); the others may not.
 * @type {Record<string, (value: unknown) => string | null>}
 */
const FIELD_SPECS = {
  schema_version: (v) => (v === CONTROL_STATE_MARKER ? null : `must be exactly "${CONTROL_STATE_MARKER}"`),
  updated_at: nonEmptyString,
  summary: nonEmptyString,
  bottleneck: nonEmptyString,
  current_p0: nonEmptyObject,
  portfolio_p0: nonEmptyObject,
  product_capabilities: nonEmptyArray,
  customer_loops: nonEmptyArray,
  active_lanes: array,
  ray_needed: array,
}

export const REQUIRED_FIELDS = Object.keys(FIELD_SPECS)

const BLOCK_RE = new RegExp(
  `^[ \\t]*<!--[ \\t]*${CONTROL_STATE_MARKER}[ \\t]*-->[ \\t]*\\r?\\n\\s*\`\`\`json[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n[ \\t]*\`\`\``,
  'gm'
)

/**
 * The canonical shape, used by tests and by anything previewing a state
 * comment. Emitting anything else would be emitting something #1140 cannot
 * read.
 *
 * @param {unknown} payload
 * @returns {string}
 */
export function serializeControlState(payload) {
  return `<!-- ${CONTROL_STATE_MARKER} -->\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``
}

/**
 * @param {string|null|undefined} body
 * @returns {unknown[]} every canonical marker block in the body, parsed.
 *   Malformed JSON is skipped rather than thrown on.
 */
export function findControlStateMarkers(body) {
  if (typeof body !== 'string') return []
  /** @type {unknown[]} */
  const out = []
  for (const match of body.matchAll(BLOCK_RE)) {
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
 * @returns {string[]} required fields that are absent. A present key holding
 *   `"UNKNOWN"` counts as present here — whether it is also *valid* is
 *   `validateControlState`'s business.
 */
export function missingRequiredFields(payload) {
  if (!isPlainObject(payload)) return [...REQUIRED_FIELDS]
  return REQUIRED_FIELDS.filter((field) => !(field in payload))
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
  /** @type {string[]} */
  const reasons = []
  const missingFields = missingRequiredFields(payload)
  if (missingFields.length > 0) reasons.push(`missing required field(s): ${missingFields.join(', ')}`)

  const record = isPlainObject(payload) ? payload : {}
  for (const [field, check] of Object.entries(FIELD_SPECS)) {
    if (!(field in record)) continue
    const problem = check(record[field])
    if (problem) reasons.push(`${field} ${problem}`)
  }

  const updatedAtMs = typeof record.updated_at === 'string' ? Date.parse(record.updated_at) : NaN
  const updatedAtParsed = !Number.isNaN(updatedAtMs)
  if (!updatedAtParsed) reasons.push('updated_at is missing or not a parseable timestamp')

  /** @type {boolean | null} */
  let fresh = null
  if (updatedAtParsed) {
    const commentMs =
      commentTimestamp instanceof Date ? commentTimestamp.getTime() : Date.parse(String(commentTimestamp))
    if (Number.isNaN(commentMs)) {
      reasons.push('comment timestamp is not parseable — cannot bound freshness')
      fresh = false
    } else {
      const age = Math.abs(commentMs - updatedAtMs)
      fresh = age <= maxFreshnessMs
      if (!fresh) {
        reasons.push(
          `updated_at is ${Math.round(age / 60000)} minutes away from the comment timestamp, ` +
            `exceeding the ${Math.round(maxFreshnessMs / 60000)}-minute bound`
        )
      }
    }
  }

  return { valid: reasons.length === 0 && fresh === true, reasons, missingFields, updatedAtParsed, fresh }
}
