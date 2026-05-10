// Fail-closed: if no config, nobody gets in
export function isAllowedEmail(email: string): boolean {
  const normalised = email.toLowerCase().trim()

  const allowedEmails = process.env.ADMIN_EMAILS
  if (allowedEmails) {
    const list = allowedEmails.split(',').map((e) => e.toLowerCase().trim())
    if (list.includes(normalised)) return true
  }

  const allowedDomain = process.env.ADMIN_EMAIL_DOMAIN
  if (allowedDomain) {
    if (normalised.endsWith('@' + allowedDomain.toLowerCase().trim())) return true
  }

  return false
}
