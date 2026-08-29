/**
 * `Primary-Issue: #<n>` — the single declaration the duplicate-lane check is
 * built on.
 *
 * "Exactly one declaration" means exactly one *occurrence*, not one distinct
 * value: a body that states `Primary-Issue: #1249` twice is an ambiguous
 * declaration (something generated it twice, and a reader cannot tell which
 * one is authoritative or whether one was meant to be edited). `Related:`,
 * `Closes:` and bare `#999` mentions are not declarations at all.
 */

const FIELD_RE = /^[ \t]*Primary-Issue[ \t]*:[ \t]*#(\d+)[ \t]*$/gim

/**
 * @param {string|null|undefined} body
 * @returns {{ ok: true, issueNumber: number } | { ok: false, reason: 'MISSING' | 'AMBIGUOUS' }}
 */
export function extractPrimaryIssue(body) {
  if (typeof body !== 'string') return { ok: false, reason: 'MISSING' }

  const occurrences = [...body.matchAll(FIELD_RE)].map((match) => Number(match[1]))
  if (occurrences.length === 0) return { ok: false, reason: 'MISSING' }
  if (occurrences.length > 1) return { ok: false, reason: 'AMBIGUOUS' }
  return { ok: true, issueNumber: occurrences[0] }
}
