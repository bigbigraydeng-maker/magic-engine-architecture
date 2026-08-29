/**
 * The `## Outcome-Contract` section a PR body must carry before it can be
 * Ready: what proof of post-merge effect is intended, over what window, and
 * who owns checking it. None of that can be known for certain before merge —
 * which is exactly why `UNKNOWN` is a legal value for every field. What is
 * not legal is silence: an omitted field means nobody thought about it, and
 * that must fail differently from "we thought about it and don't know yet".
 */

export const OUTCOME_CONTRACT_FIELDS = ['Proof', 'Verification-Window', 'Owner', 'Status']

const SECTION_RE = /^##\s*Outcome-Contract\s*$/im

/**
 * @param {string} body
 * @returns {string | null} the section body, from the heading to the next
 *   heading of the same or higher level, or end of string.
 */
function extractSection(body) {
  if (typeof body !== 'string') return null
  const headingMatch = SECTION_RE.exec(body)
  if (!headingMatch) return null

  const start = headingMatch.index + headingMatch[0].length
  const rest = body.slice(start)
  const nextHeading = rest.search(/^##\s+\S/m)
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading)
}

/**
 * @param {string} sectionBody
 * @returns {Record<string, string>}
 */
function parseFields(sectionBody) {
  /** @type {Record<string, string>} */
  const fields = {}
  const lineRe = /^[ \t]*[-*][ \t]*([A-Za-z][A-Za-z-]*)[ \t]*:[ \t]*(.+?)[ \t]*$/gim
  for (const match of sectionBody.matchAll(lineRe)) {
    const label = OUTCOME_CONTRACT_FIELDS.find((f) => f.toLowerCase() === match[1].toLowerCase())
    if (label) fields[label] = match[2].trim()
  }
  return fields
}

/**
 * @param {string|null|undefined} body
 * @returns {{ ok: true, fields: Record<string,string> } | { ok: false, reason: 'MISSING_SECTION' | 'MISSING_FIELDS', missing?: string[] }}
 */
export function extractOutcomeContract(body) {
  const section = extractSection(body ?? '')
  if (section === null) return { ok: false, reason: 'MISSING_SECTION' }

  const fields = parseFields(section)
  const missing = OUTCOME_CONTRACT_FIELDS.filter((f) => !(f in fields) || fields[f] === '')
  if (missing.length > 0) return { ok: false, reason: 'MISSING_FIELDS', missing }

  return { ok: true, fields }
}
