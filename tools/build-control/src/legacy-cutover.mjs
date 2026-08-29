/**
 * Grandfathering: 46 PRs already existed when this gate was designed, and the
 * admission check must not turn all of them red the moment it ships. A PR
 * created before the cutover is graded `LEGACY_TRIAGE_REQUIRED` rather than
 * failed outright when it is missing the fields this gate would otherwise
 * require — a truthful "this predates the rule and needs a human look",
 * never silently treated as if it had passed the rule it never saw.
 *
 * The cutover timestamp is a constant, not something read from repository
 * state, so its meaning cannot drift between one workflow run and the next.
 */

/** 2026-08-30T00:00:00Z — the day after the design-review repository-fact SHA
 * (`423af321fa18e23d86256f1da17dcff56e67e0bc`, fetched 2026-08-30 NZST) was
 * recorded in Issue #1249. Any PR opened at or after this instant is expected
 * to already comply. */
export const CUTOVER_ISO = '2026-08-30T00:00:00Z'
export const CUTOVER_MS = Date.parse(CUTOVER_ISO)

/**
 * @param {string | Date} createdAt
 * @returns {boolean}
 */
export function isLegacyPr(createdAt) {
  const ms = createdAt instanceof Date ? createdAt.getTime() : Date.parse(String(createdAt))
  if (Number.isNaN(ms)) {
    // An unparseable creation date cannot be trusted to predate the cutover —
    // fail closed into "not legacy", which is the stricter branch.
    return false
  }
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
