/**
 * `ME_OUTCOME_RECEIPT_V1` — the marker that lets a business IMPACT Issue
 * actually close.
 *
 * CLAUDE.md's IMPACT loop is Inspect → Measure → Prescribe → Act → Check →
 * Tune, and this repo's recurring failure mode (named explicitly in Issue
 * #1249) is calling *Act* finished and reporting it as if it were the whole
 * loop. So the receipt names five stages — Execution, Activation,
 * Measurement/Check, Outcome classification, Tune/next-decision — and
 * completion is judged only on the three that prove the loop actually closed:
 * Measurement, Outcome and Tune. Execution alone (the engineering work
 * landed) is necessary but never sufficient; Activation is real work that
 * does not exist for every loop (e.g. a change that is live the moment it
 * merges has no separate activation step), so it must be *present* but is not
 * part of the completion test.
 */

export const OUTCOME_RECEIPT_MARKER = 'ME_OUTCOME_RECEIPT_V1'

export const RECEIPT_STAGES = ['execution', 'activation', 'measurement', 'outcome', 'tune']

/** Stages whose status must read DONE for the receipt to close a business loop. */
const COMPLETION_STAGES = ['measurement', 'outcome', 'tune']

export const VALID_STAGE_STATUSES = new Set(['DONE', 'PENDING', 'UNKNOWN'])

const MARKER_RE = new RegExp(`<!--\\s*${OUTCOME_RECEIPT_MARKER}\\s*:\\s*(\\{[\\s\\S]*?\\})\\s*-->`, 'g')

/**
 * @param {unknown} payload
 * @returns {string}
 */
export function serializeOutcomeReceipt(payload) {
  return `<!-- ${OUTCOME_RECEIPT_MARKER}: ${JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')} -->`
}

/**
 * @param {string|null|undefined} body
 * @returns {unknown[]}
 */
export function findOutcomeReceiptMarkers(body) {
  if (typeof body !== 'string') return []
  const out = []
  for (const match of body.matchAll(MARKER_RE)) {
    try {
      out.push(JSON.parse(match[1]))
    } catch {
      // skip malformed payload rather than fail the whole read
    }
  }
  return out
}

/**
 * Structural validity: every stage key present, each an object with a
 * recognised `status`. This is deliberately weaker than completion — a
 * structurally valid receipt can still be "Execution DONE, everything else
 * PENDING", which is exactly the case `isImpactComplete` must reject.
 *
 * @param {unknown} payload
 * @returns {{ valid: boolean, reasons: string[] }}
 */
export function validateOutcomeReceiptShape(payload) {
  const reasons = []
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, reasons: ['payload is not an object'] }
  }
  const record = /** @type {Record<string, unknown>} */ (payload)

  for (const stage of RECEIPT_STAGES) {
    if (!(stage in record)) {
      reasons.push(`missing stage: ${stage}`)
      continue
    }
    const value = record[stage]
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      reasons.push(`stage ${stage} is not an object`)
      continue
    }
    const status = /** @type {Record<string, unknown>} */ (value).status
    if (typeof status !== 'string' || !VALID_STAGE_STATUSES.has(status)) {
      reasons.push(`stage ${stage} has an invalid status: ${JSON.stringify(status)}`)
    }
  }

  return { valid: reasons.length === 0, reasons }
}

/**
 * Can this receipt close a business IMPACT Issue? Requires structural
 * validity plus Measurement, Outcome and Tune all reading DONE. Execution
 * being DONE (or not) is irrelevant to this test — a shape violation there is
 * already caught by `validateOutcomeReceiptShape`.
 *
 * @param {unknown} payload
 * @returns {{ complete: boolean, reasons: string[] }}
 */
export function isImpactComplete(payload) {
  const shape = validateOutcomeReceiptShape(payload)
  if (!shape.valid) return { complete: false, reasons: shape.reasons }

  const record = /** @type {Record<string, { status: string }>} */ (payload)
  const notDone = COMPLETION_STAGES.filter((stage) => record[stage].status !== 'DONE')
  if (notDone.length > 0) {
    return {
      complete: false,
      reasons: notDone.map((stage) => `stage ${stage} is ${record[stage].status}, not DONE`),
    }
  }
  return { complete: true, reasons: [] }
}
