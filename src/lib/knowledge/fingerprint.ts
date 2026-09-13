/**
 * Client knowledge base — content fingerprint (design §9.14-A/B).
 *
 * A customer's confirmation is only valid for the exact content they saw.
 * The fingerprint binds a confirmation to that content: any change to the
 * statement, its structured value, scope, validity window, visibility, or
 * sensitivity invalidates the confirmation (§9.14-B — a fact edited after
 * confirmation must go back to "awaiting confirmation", not keep riding on
 * a stale approval).
 *
 * Fixed key order + JSON.stringify is enough here: this is a change-detector,
 * not a security signature, so a full cryptographic hash is not required —
 * but the fields it covers and their order must never change without also
 * invalidating every stored confirmation (bump `FINGERPRINT_VERSION`).
 */

export interface FingerprintableFact {
  statement: string
  structuredValue: unknown
  scope: unknown
  validFrom: string
  validUntil: string | null
  visibility: string
  sensitivity: string
}

const FINGERPRINT_VERSION = 2

/** Stable stringify: sorts object keys recursively so field order never affects the result. */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Deterministic fingerprint of everything a customer's confirmation must be
 * re-validated against. Same inputs always produce the same output; any
 * single field changing produces a different output.
 */
export function computeFactFingerprint(fact: FingerprintableFact): string {
  return stableStringify({
    v: FINGERPRINT_VERSION,
    statement: fact.statement,
    structuredValue: fact.structuredValue ?? null,
    scope: fact.scope ?? {},
    validFrom: fact.validFrom,
    validUntil: fact.validUntil,
    visibility: fact.visibility,
    sensitivity: fact.sensitivity,
  })
}

/** True when a stored confirmation still matches the fact's current content. */
export function isConfirmationCurrent(
  fact: FingerprintableFact,
  confirmedFingerprint: string | null | undefined,
): boolean {
  if (!confirmedFingerprint) return false
  return computeFactFingerprint(fact) === confirmedFingerprint
}
