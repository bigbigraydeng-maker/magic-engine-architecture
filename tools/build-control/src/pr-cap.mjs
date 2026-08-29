/**
 * Recovery cap: the repository had 46 open PRs at design time against a
 * target of 12.
 *
 * Cap semantics, stated once so both callers can agree: `openPrCount` is the
 * number of open PRs **excluding the one being admitted**, so the lane being
 * judged would make it `openPrCount + 1`. A cap of 12 therefore permits the
 * twelfth open PR and blocks the thirteenth.
 *
 * The cap only ever blocks *new* implementation work — a remediation or review
 * comment on a PR that already exists is not a new lane, and must never be
 * blocked by how large the existing backlog is, or fixing the mess would be
 * blocked by the mess.
 */

export const RECOVERY_OPEN_PR_CAP = 12

/**
 * @param {{
 *   openPrCount: number,
 *   isNewImplementation: boolean,
 *   override?: import('./cap-override.mjs').CapOverrideRecord | null,
 * }} input `override` must already be verified by `selectCapOverride`.
 * @returns {{ blocked: boolean, reason: string }}
 */
export function evaluateCap({ openPrCount, isNewImplementation, override = null }) {
  if (!isNewImplementation) {
    return { blocked: false, reason: 'not a new implementation lane — the cap does not apply' }
  }

  const wouldBeOpen = openPrCount + 1
  if (wouldBeOpen <= RECOVERY_OPEN_PR_CAP) {
    return { blocked: false, reason: `this lane would be open PR ${wouldBeOpen} of ${RECOVERY_OPEN_PR_CAP}` }
  }
  if (override) {
    return {
      blocked: false,
      reason:
        `cap reached (this lane would be open PR ${wouldBeOpen} of ${RECOVERY_OPEN_PR_CAP}) but overridden by ` +
        `${override.granted_by} until ${override.expires_at}: ${override.reason}`,
    }
  }
  return {
    blocked: true,
    reason:
      `this lane would be open PR ${wouldBeOpen}, above the recovery cap of ${RECOVERY_OPEN_PR_CAP}, ` +
      'and no valid override was presented',
  }
}
