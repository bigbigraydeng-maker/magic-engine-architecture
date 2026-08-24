/**
 * Pure decision function for the Codex-review -> Claude-fix leg. No I/O: the
 * caller has already fetched the PR's markers, this round's findings, and CI
 * status, so this is fully unit-testable offline (see tests/plan.test.ts).
 *
 * Dedup: keyed on (head sha, stage-about-to-be-written). If a marker for this
 * exact sha already exists for any terminal-or-dispatch stage, this event is a
 * duplicate delivery (or a second review on an unchanged head) and the run is
 * a no-op.
 *
 * Round cap: counted from the number of `fix-dispatched` markers already
 * posted for this PR (across all shas) — not from severities or arbitrary
 * event counts, so a duplicate-delivered event never inflates it, since
 * duplicates are already caught by the dedup check above.
 *
 * Staleness: only checked on the dispatch path, because it is the only path
 * that pushes. `isStale` means the caller re-fetched the PR right before this
 * decision and found a head sha newer than the one Codex reviewed — someone
 * pushed while this event was in flight. Dispatching anyway would base a fix
 * on findings for code that is no longer current, and could push on top of
 * work in progress on a branch this repo's convention says only one window
 * holds at a time (CLAUDE.md §6). Skipping is free: the newer push already
 * triggers its own review-request, which re-enters this same decision later.
 */
export function decideStage({ markers, sha, hasActionableFindings, ciSuccess, maxRounds, isStale = false }) {
  const hasMarkerForSha = (stage) => markers.some((m) => m.stage === stage && m.sha === sha)

  if (hasMarkerForSha('fix-dispatched') || hasMarkerForSha('needs-human') || hasMarkerForSha('ready')) {
    return { action: 'skip', reason: `already handled head sha ${sha}` }
  }

  if (hasActionableFindings) {
    if (isStale) {
      return { action: 'skip', reason: `head moved past ${sha} before this round could dispatch` }
    }
    const round = markers.filter((m) => m.stage === 'fix-dispatched').length + 1
    if (round > maxRounds) {
      return { action: 'needs-human', round }
    }
    return { action: 'dispatch-fix', round }
  }

  if (!ciSuccess) {
    return { action: 'wait-ci' }
  }

  return { action: 'ready' }
}
