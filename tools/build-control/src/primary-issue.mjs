/**
 * `Primary-Issue: #<n>` is the field the whole duplicate-detection system is
 * built on, so it has to be unambiguous. Two failure modes matter equally:
 *
 * - A PR that never says which Issue it implements (missing).
 * - A PR body containing an unrelated `Related: #999` or `Closes #999` that
 *   gets mistaken for the primary declaration, which would either wrongly
 *   flag two unrelated PRs as duplicates or let a real duplicate slip through
 *   under a different apparent primary issue.
 *
 * So the regex matches only the literal field name at the start of a line,
 * case-insensitively on the label but not on structure, and a body that
 * declares the field more than once with *different* numbers is ambiguous
 * rather than "first one wins" — silently picking one would hide a bug in
 * whatever generated the PR body.
 */

const FIELD_RE = /^[ \t]*Primary-Issue[ \t]*:[ \t]*#(\d+)[ \t]*$/gim

/**
 * @param {string|null|undefined} body
 * @returns {{ ok: true, issueNumber: number } | { ok: false, reason: 'MISSING' | 'AMBIGUOUS' }}
 */
export function extractPrimaryIssue(body) {
  if (typeof body !== 'string') return { ok: false, reason: 'MISSING' }

  const found = new Set()
  for (const match of body.matchAll(FIELD_RE)) {
    found.add(Number(match[1]))
  }

  if (found.size === 0) return { ok: false, reason: 'MISSING' }
  if (found.size > 1) return { ok: false, reason: 'AMBIGUOUS' }
  return { ok: true, issueNumber: [...found][0] }
}

/**
 * `Related:` / `Closes:` / bare `#999` mentions must never satisfy the
 * requirement on their own. This is exercised directly by tests rather than
 * inferred from `extractPrimaryIssue` alone, so a future regex change that
 * accidentally widens the match is caught at the unit that states the intent.
 *
 * @param {string} body
 * @returns {boolean}
 */
export function hasExplicitPrimaryIssueField(body) {
  // A fresh RegExp, not the module-level `FIELD_RE` — that one carries the
  // `g` flag, and reusing a global regex across repeated `.test()` calls
  // mutates its `lastIndex` and makes the result depend on call history.
  return typeof body === 'string' && new RegExp(FIELD_RE.source, 'im').test(body)
}
