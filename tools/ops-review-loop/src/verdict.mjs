/**
 * Shared glue between the two places that reach a delivery-readiness verdict
 * for a PR already known to be past its Codex-review gate:
 * `handle-review.mjs`'s `ready` case (a Codex review just landed clean) and
 * `recheck-readiness.mjs` (an unsampled C-level PR's required CI just went
 * green). Both need the identical sequence — fetch changed files, classify
 * risk against the trusted rating as a floor, compute specialised evidence
 * and observed signals, score, decide, render the comment — so it lives here
 * once rather than drifting between two copies.
 *
 * Deliberately I/O-touching (calls `github.mjs`), so it is not a pure module,
 * but it does not execute anything at import time — every effect happens
 * inside `buildVerdictComment`, which is why it is safe for two different
 * entrypoint scripts (each with their own env-derived `token`/`owner`/`repo`)
 * to import it without triggering each other's side effects.
 */
import { listPullRequestFiles } from './github.mjs'
import { classifyRisk } from './risk.mjs'
import { requiredSpecializedEvidence, evaluateSpecializedEvidence } from './quality.mjs'
import { collectObservedSignals, observedSpecializedEvidence } from './evidence.mjs'
import { evaluateReadiness } from './readiness-decision.mjs'
import { buildReadinessComment } from './report.mjs'

/**
 * The auto-fix blast-radius guard's own check run — see ops-fix-scope-guard.yml.
 * Exported so recheck-readiness.mjs and request-review.mjs can require this
 * check to be terminal before locking in a verdict that scores it — see the
 * P2 finding on PR #1211 documented at each of those call sites.
 */
export const SCOPE_GUARD_CHECK_NAME_PATTERN = /ops-fix-scope-guard/i

function checkSucceeded(run) {
  return run?.status === 'completed' && run?.conclusion === 'success'
}

/**
 * Score delivery quality and produce the READY/BLOCKED verdict + comment
 * text for one PR whose Codex-review obligation (owed or not) has already
 * been resolved by the caller.
 *
 * @param {{
 *   token: string, owner: string, repo: string,
 *   prNumber: number, prBody: string|null, base: string, sha: string,
 *   risk: string|null|undefined,
 *   shaMatches: boolean,
 *   checkRuns: Array<{name: string, status: string, conclusion: string|null}>,
 *   requiredCiPassed: boolean, openBlockerCount?: number,
 * }} input `risk` may be `null`/`undefined` when the caller found no current
 *   trusted gate marker; `shaMatches` must then be `false` — the caller
 *   decides that, since only it knows whether it actually found one (see
 *   `handle-review.mjs`'s `risk ?? null` / `Boolean(currentGate)` pair vs.
 *   `recheck-readiness.mjs`, which never reaches this function without one).
 * @returns {Promise<{decision: ReturnType<typeof evaluateReadiness>['decision'], comment: string}>}
 */
export async function buildVerdictComment({
  token,
  owner,
  repo,
  prNumber,
  prBody,
  base,
  sha,
  risk,
  shaMatches,
  checkRuns,
  requiredCiPassed,
  openBlockerCount = 0,
}) {
  let files = null
  let filesReadable = true
  try {
    files = await listPullRequestFiles(token, owner, repo, prNumber)
  } catch (err) {
    filesReadable = false
    console.log(`PR #${prNumber}: could not read changed files: ${err.message}`)
  }
  const rated = classifyRisk({ files, declaredRisk: risk })
  const effectiveRisk = risk ?? rated.risk
  const required = requiredSpecializedEvidence(rated.categories)
  const observedSpecialized = observedSpecializedEvidence(prBody, required)
  const specialized = evaluateSpecializedEvidence({ categories: rated.categories, observed: observedSpecialized })
  const scopeGuardRun = checkRuns.find((r) => SCOPE_GUARD_CHECK_NAME_PATTERN.test(r.name))
  const observedSignals = collectObservedSignals({
    prBody,
    files,
    requiredCiPassed,
    scopeGuardPassed: checkSucceeded(scopeGuardRun),
    riskRated: shaMatches,
    specializedEvidenceComplete: specialized.complete === true,
  })
  const evidenceReadable = filesReadable && rated.readable && shaMatches

  const { decision } = evaluateReadiness({
    risk: effectiveRisk,
    observedSignals,
    specialized,
    shaMatches,
    evidenceReadable,
    requiredCiPassed,
    openBlockerCount,
  })

  return {
    decision,
    comment: buildReadinessComment({
      decision: decision.decision,
      risk: effectiveRisk,
      score: decision.score,
      threshold: decision.threshold,
      blockers: decision.blockers,
      base,
      head: sha,
    }),
  }
}
