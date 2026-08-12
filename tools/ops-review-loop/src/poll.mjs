/**
 * Codex finding (PR #906, P2): a clean Codex review that lands before the
 * required check has finished produces `wait-ci` and nothing else — this
 * workflow only listens to `pull_request_review.submitted`, so CI turning
 * green afterward never re-triggers a decision for that same head sha, and a
 * PR that already meets the bar can go without READY FOR PRODUCT OWNER
 * indefinitely.
 *
 * Fix: poll the required check within the same run, bounded by attempts and
 * interval, before giving up and falling back to `wait-ci`. `fetchCheckRuns`
 * and `sleep` are injected so this stays testable without real network calls
 * or real waiting.
 *
 * Codex finding (PR #943, P2): returning a bare `null` on timeout threw away
 * the difference between "the required check does not exist on this commit"
 * and "it exists and is still running". The caller could only see absence, so
 * a normal slow-starting check was reported to maintainers as "never reported
 * on this commit" — a confident, wrong diagnosis pointing them at the wrong
 * problem. That is the same failure this polling exists to prevent, one level
 * up.
 *
 * So: return `{ check, sawIt }`. `check` is the completed run when one was
 * seen, otherwise the last observation of it (possibly still queued/running);
 * `sawIt` says whether the check was ever present at all.
 */
export async function waitForRequiredCheck({ fetchCheckRuns, sleep, pattern, maxAttempts = 12, intervalMs = 20000 }) {
  let lastSeen = null
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const checkRuns = await fetchCheckRuns()
    const requiredCheck = checkRuns.find((run) => pattern.test(run.name))
    if (requiredCheck) {
      lastSeen = requiredCheck
    }
    if (requiredCheck?.status === 'completed') {
      return { check: requiredCheck, sawIt: true }
    }
    if (attempt < maxAttempts - 1) {
      await sleep(intervalMs)
    }
  }
  return { check: lastSeen, sawIt: lastSeen !== null }
}
