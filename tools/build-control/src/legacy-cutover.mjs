/**
 * Grandfathering for the PRs that already existed when this gate was designed:
 * a PR created before the cutover is graded `LEGACY_TRIAGE_REQUIRED` rather
 * than failed, which is truthful ("this predates the rule and needs a human
 * look") without ever reading as if it had passed the rule it never saw.
 *
 * The cutover is the exact instant the Issue #1249 contract was created, not a
 * rounded-up midnight — rounding forward would grandfather every PR opened in
 * the hours between the contract existing and this code landing, which is
 * precisely the window a bypass would use.
 */

/** Issue #1249 contract creation instant. */
export const CUTOVER_ISO = '2026-08-29T13:03:37Z'
export const CUTOVER_MS = Date.parse(CUTOVER_ISO)

/**
 * @param {string | Date} createdAt
 * @returns {boolean}
 */
export function isLegacyPr(createdAt) {
  const ms = createdAt instanceof Date ? createdAt.getTime() : Date.parse(String(createdAt))
  // An unparseable creation date cannot be trusted to predate the cutover —
  // fail closed into "not legacy", which is the stricter branch.
  if (Number.isNaN(ms)) return false
  return ms < CUTOVER_MS
}

/**
 * @param {{ createdAt: string | Date, wouldFail: boolean }} input
 * @returns {'PASS' | 'FAIL' | 'LEGACY_TRIAGE_REQUIRED'}
 */
export function applyCutoverGrading({ createdAt, wouldFail }) {
  if (!wouldFail) return 'PASS'
  return isLegacyPr(createdAt) ? 'LEGACY_TRIAGE_REQUIRED' : 'FAIL'
}
