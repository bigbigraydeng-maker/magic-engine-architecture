/**
 * Feature gate for dual-window attribution — Issue #859, PR #862.
 *
 * Pass 1 defers `seo.gsc.*` actions to the GSC bridge, so the bridge also
 * computes them at pass 1's window on top of its own 28-day cadence. That is
 * correct attribution: without it, the window pass 1 was asked about is
 * answered by nobody.
 *
 * It is nevertheless OFF in production, because the consumers that read
 * `flywheel_outcomes` as evidence still count ROWS in places this PR is not
 * authorised to touch:
 *
 *   · src/lib/memory/learning-rollup.ts — scheduled weekly (Mon 07:00) and
 *     already running; it counts outcome rows per verdict in a week window.
 *   · src/lib/memory/extractor.ts — not scheduled, but 21 rows in
 *     client_proven_patterns / client_failed_experiments already came from it,
 *     so its semantics are live data, not a clean slate.
 *
 * Turning dual-window on before those dedupe by action would double the
 * evidence behind every deferred action: `MIN_OCCURRENCES_FOR_PREFERENCE` is 3,
 * so a single action could manufacture a "consistently outperforms" preference,
 * and the industry benchmarks shown to clients would move. That is a real
 * change to client-visible numbers, not a theoretical risk.
 *
 * The consumers inside this PR's scope (case-library benchmarks and the three
 * confidence readers) already collapse per action — see
 * `keepOneCasePerAction`. The memory consumers are the follow-up PR's job, and
 * this flag is what keeps the two from being coupled.
 *
 * 🔴 Do not flip this on until that PR has landed.
 */

/** Env var name, exported so tests and docs cannot drift from the code. */
export const DUAL_WINDOW_FLAG = 'ATTRIBUTION_DUAL_WINDOW_ENABLED'

/**
 * Whether the deferred window may be computed in addition to the cadence one.
 *
 * Default OFF: anything other than the exact string `'true'` — unset, empty,
 * `'1'`, `'yes'`, a typo — leaves production on its current behaviour. A flag
 * whose failure mode is "silently on" is not a safety gate.
 */
export function dualWindowEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return env[DUAL_WINDOW_FLAG] === 'true'
}
