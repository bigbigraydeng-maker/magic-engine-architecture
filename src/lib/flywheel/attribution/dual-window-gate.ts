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
 * WHAT "OFF" ACTUALLY ENFORCES. Refusing to *write* a second window is only
 * half of it. On main every writer DELETEd by action before inserting, so an
 * action could never hold two windows; removing that delete was necessary — it
 * is what stopped the two writers destroying each other's rows — but it means a
 * row written at a custom window by an older deployment now SURVIVES alongside
 * the cadence one, and the row-counting consumers double-count that action just
 * the same. So while this flag is off, each writer also retires its own rows at
 * any window other than the authoritative one (`reconcileLegacyWindows`, in
 * both writers). Scoped to its own evaluator, so it is never the cross-writer
 * delete this Work Package removed. With the flag ON, nothing is retired —
 * those rows are legitimate. (Codex P1, round 16 on PR #862.)
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

export interface EffectiveWindow {
  /** The window the caller may actually use. */
  windowDays: number
  /** True when a caller-supplied window was declined because the gate is off. */
  overrideRefused: boolean
  /** What the caller asked for, when that differed. */
  requested?: number
}

/**
 * The one place that decides which attribution window a caller may use.
 *
 * Every entry point that accepts a window is a way to create a SECOND window
 * for an action, and every one of them multiplies the evidence the row-counting
 * consumers see. They were fixed one at a time — the cron's deferred handoff,
 * then the manual GSC endpoint, then pass 1's own `?window_days=` — which is
 * how a fourth is found later. Routing them all through this function is what
 * makes "dual window is off" a statement about the system rather than about
 * whichever call site was remembered.
 *
 * On main every writer DELETEd without a window filter, so a re-run at a
 * different window replaced the previous rows and an action never held more
 * than one window's worth. The natural key now includes `window_days`, which is
 * correct — a 7-day and a 28-day answer are different facts — but it turns
 * replace into append. Until the memory consumers count by action, only the
 * authoritative window may be written.
 *
 * The refusal is reported, never silent: a caller who asked for 7 days and
 * quietly got 28 would read the answer as a 7-day one.
 */
export function resolveEffectiveWindow(
  requested: number | undefined,
  authoritative: number,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): EffectiveWindow {
  const wanted =
    requested !== undefined && Number.isInteger(requested) && requested > 0
      ? requested
      : authoritative

  if (dualWindowEnabled(env)) return { windowDays: wanted, overrideRefused: false }

  return wanted === authoritative
    ? { windowDays: authoritative, overrideRefused: false }
    : { windowDays: authoritative, overrideRefused: true, requested: wanted }
}
