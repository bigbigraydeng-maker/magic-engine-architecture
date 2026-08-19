/**
 * Parse a free-text or array field into a deduped list of valid email
 * addresses — same shape as parseDomainList in crm/contact-kind.ts, but for
 * the notify_emails column (leads_config), which needs full addresses rather
 * than bare domains.
 *
 * Pure function, no Supabase — kept separate so it's unit-testable without a
 * Next.js route context (route.ts files can only export GET/POST/etc, see
 * the leads-config route this backs).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MAX_LEN = 160

export interface ParsedEmailList {
  emails: string[]
  rejected: string[]
}

export function parseEmailList(input: unknown): ParsedEmailList {
  const pieces = Array.isArray(input)
    ? input.filter((x): x is string => typeof x === 'string')
    : typeof input === 'string'
      ? input.split(/[\n\r,;、，；]+/)
      : []

  const emails: string[] = []
  const rejected: string[] = []
  for (const piece of pieces) {
    const t = piece.trim().toLowerCase()
    if (!t) continue
    if (EMAIL_RE.test(t) && t.length <= MAX_LEN) {
      if (!emails.includes(t)) emails.push(t)
    } else {
      rejected.push(piece.trim())
    }
  }
  return { emails, rejected }
}
