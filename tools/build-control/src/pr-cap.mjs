/**
 * Recovery cap: the repository had 46 open PRs at design time against a
 * target of 12. The cap only ever blocks *new* implementation work — a
 * remediation or review comment on a PR that already exists is not "new
 * implementation lane" work and must never be blocked by how large the
 * existing backlog is, or fixing something would itself be blocked by the
 * mess that needs fixing.
 */

export const RECOVERY_OPEN_PR_CAP = 12

/**
 * @param {{ openPrCount: number, isNewImplementation: boolean, override?: { grantedBy: string, allowlist: Iterable<string>, reason: string } | null }} input
 * @returns {{ blocked: boolean, reason: string }}
 */
export function evaluateCap({ openPrCount, isNewImplementation, override = null }) {
  if (!isNewImplementation) {
    return { blocked: false, reason: 'not a new implementation lane — the cap does not apply' }
  }
  if (openPrCount < RECOVERY_OPEN_PR_CAP) {
    return { blocked: false, reason: `open PR count ${openPrCount} is below the cap of ${RECOVERY_OPEN_PR_CAP}` }
  }

  if (override) {
    const allowlist = new Set([...override.allowlist].filter((login) => typeof login === 'string'))
    const reasonGiven = typeof override.reason === 'string' && override.reason.trim() !== ''
    if (allowlist.has(override.grantedBy) && reasonGiven) {
      return {
        blocked: false,
        reason: `cap reached (${openPrCount} >= ${RECOVERY_OPEN_PR_CAP}) but overridden by allow-listed ${override.grantedBy}: ${override.reason}`,
      }
    }
  }

  return {
    blocked: true,
    reason: `open PR count ${openPrCount} is at or above the recovery cap of ${RECOVERY_OPEN_PR_CAP}, and no valid override was presented`,
  }
}
