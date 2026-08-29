/**
 * `ME_OUTCOME_RECEIPT_V1` — the receipt that lets a business IMPACT Issue
 * actually close.
 *
 * CLAUDE.md's loop is Inspect → Measure → Prescribe → Act → Check → Tune, and
 * the failure mode Issue #1249 names is calling *Act* finished and reporting
 * it as the whole loop. So closing requires Execution **and** Measurement/Check
 * **and** Outcome classification **and** Tune/next-decision, each `DONE` with
 * non-empty evidence — a status word on its own is not proof. Activation must
 * be present but may be `UNKNOWN`: it is real work that does not exist for
 * every loop (a change live the moment it merges has no separate activation).
 *
 * Provenance is bound the same way as merge authorisation: an allow-listed
 * comment author whose login matches the payload's own `recorded_by` /
 * `authorized_by`. A random commenter cannot close an impact-loop Issue.
 */

import { findMarkers, serializeMarker } from './markers.mjs'

export const OUTCOME_RECEIPT_MARKER = 'ME_OUTCOME_RECEIPT_V1'

export const RECEIPT_STAGES = ['execution', 'activation', 'measurement', 'outcome', 'tune']

/** Stages that must read DONE, with evidence, for the receipt to close a loop. */
export const COMPLETION_STAGES = ['execution', 'measurement', 'outcome', 'tune']

export const VALID_STAGE_STATUSES = new Set(['DONE', 'PENDING', 'UNKNOWN'])

/** Keys naming who produced the receipt; every one present must match the author. */
const ACTOR_KEYS = ['recorded_by', 'authorized_by']

/**
 * @param {unknown} payload
 * @returns {string}
 */
export function serializeOutcomeReceipt(payload) {
  return serializeMarker(OUTCOME_RECEIPT_MARKER, payload)
}

/**
 * Receipts from allow-listed authors whose declared actor agrees with the
 * actual comment author, in comment order.
 *
 * @param {{ comments: Array<{ author?: string | null, body?: string | null }>, allowlist: Iterable<string> }} input
 * @returns {{ trusted: unknown[], rejected: string[] }}
 */
export function selectTrustedOutcomeReceipts({ comments, allowlist }) {
  const allowed = new Set([...(allowlist ?? [])].filter((login) => typeof login === 'string'))
  /** @type {unknown[]} */
  const trusted = []
  /** @type {string[]} */
  const rejected = []

  for (const comment of Array.isArray(comments) ? comments : []) {
    if (!comment) continue
    const author = comment.author ?? null
    for (const payload of findMarkers(OUTCOME_RECEIPT_MARKER, comment.body)) {
      if (!allowed.has(author)) {
        rejected.push(`a receipt from ${author ?? '(unattributed)'} is not from an allow-listed Outcome recorder`)
        continue
      }
      const declared = ACTOR_KEYS.map((key) => /** @type {Record<string, unknown>} */ (payload ?? {})[key]).filter(
        (v) => v !== undefined
      )
      if (declared.length === 0) {
        rejected.push(`a receipt from ${author} declares no recorded_by/authorized_by`)
        continue
      }
      if (declared.some((v) => v !== author)) {
        rejected.push(`a receipt from ${author} declares a different recorded_by/authorized_by`)
        continue
      }
      trusted.push(payload)
    }
  }
  return { trusted, rejected }
}

/**
 * Structural validity: every stage present, an object, with a recognised
 * status. Deliberately weaker than completion — "Execution DONE, everything
 * else PENDING" is structurally valid and is exactly what must not close.
 *
 * @param {unknown} payload
 * @returns {{ valid: boolean, reasons: string[] }}
 */
export function validateOutcomeReceiptShape(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, reasons: ['payload is not an object'] }
  }
  const record = /** @type {Record<string, unknown>} */ (payload)
  /** @type {string[]} */
  const reasons = []

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
 * @param {unknown} payload
 * @returns {{ complete: boolean, reasons: string[] }}
 */
export function isImpactComplete(payload) {
  const shape = validateOutcomeReceiptShape(payload)
  if (!shape.valid) return { complete: false, reasons: shape.reasons }

  const record = /** @type {Record<string, { status: string, evidence?: unknown }>} */ (payload)
  /** @type {string[]} */
  const reasons = []
  for (const stage of COMPLETION_STAGES) {
    const { status, evidence } = record[stage]
    if (status !== 'DONE') {
      reasons.push(`stage ${stage} is ${status}, not DONE`)
      continue
    }
    if (typeof evidence !== 'string' || evidence.trim() === '') {
      reasons.push(`stage ${stage} claims DONE with no evidence — a status word is not proof`)
    }
  }
  return { complete: reasons.length === 0, reasons }
}
