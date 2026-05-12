// Fail-closed: if no config, nobody gets in

export type UserRole = 'admin' | 'client-viewer'

export interface UserPermissions {
  role: UserRole
  allowedClientId: string | null  // null = all clients; UUID for restricted access
}

export function isAllowedEmail(email: string): boolean {
  return getUserPermissions(email) !== null
}

export function getUserPermissions(email: string): UserPermissions | null {
  const normalised = email.toLowerCase().trim()

  // Check CLIENT_VIEWERS first (format: "email:clientId,email2:clientId2")
  const clientViewers = process.env.CLIENT_VIEWERS ?? ''
  for (const entry of clientViewers.split(',').map((e) => e.trim()).filter(Boolean)) {
    const colonIndex = entry.indexOf(':')
    if (colonIndex === -1) continue
    const viewerEmail = entry.slice(0, colonIndex).toLowerCase().trim()
    const clientId = entry.slice(colonIndex + 1).trim()
    if (viewerEmail === normalised) {
      return { role: 'client-viewer', allowedClientId: clientId }
    }
  }

  // Check ADMIN_EMAILS
  const allowedEmails = process.env.ADMIN_EMAILS
  if (allowedEmails) {
    const list = allowedEmails.split(',').map((e) => e.toLowerCase().trim())
    if (list.includes(normalised)) return { role: 'admin', allowedClientId: null }
  }

  // Check ADMIN_EMAIL_DOMAIN
  const allowedDomain = process.env.ADMIN_EMAIL_DOMAIN
  if (allowedDomain) {
    if (normalised.endsWith('@' + allowedDomain.toLowerCase().trim())) {
      return { role: 'admin', allowedClientId: null }
    }
  }

  return null
}
