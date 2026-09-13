/**
 * Client knowledge base — identity checks for the rollout switch and
 * confirmer registration (design §9.14-B).
 *
 * Deliberately narrower than `src/lib/auth/whitelist.ts#getUserPermissions`:
 * that function also grants access to `ADMIN_EMAIL_DOMAIN` matches and
 * `DEMO_ADMINS` scoped accounts, which is the right policy for "can this
 * person open the ME dashboard" but the wrong policy for "can this person
 * turn on AI replies to a real customer, or register who speaks for the
 * client" — a scoped demo account or a domain-matched contractor email
 * should not be able to do either.
 */

function normaliseEmail(email: string): string {
  return email.toLowerCase().trim()
}

/**
 * True only for an exact match against `ADMIN_EMAILS` — the strictest
 * identity check in the app. Does NOT accept `ADMIN_EMAIL_DOMAIN` matches:
 * a domain-wide allowance is meant for dashboard access, not for turning the
 * knowledge base on/off for a real customer or registering their confirmer.
 */
export function isGlobalKnowledgeAdmin(email: string): boolean {
  const normalised = normaliseEmail(email)
  const allowedEmails = process.env.ADMIN_EMAILS
  if (!allowedEmails) return false
  return allowedEmails
    .split(',')
    .map((e) => e.toLowerCase().trim())
    .includes(normalised)
}

// Known ME company domains. Not sourced from ADMIN_EMAIL_DOMAIN — that env
// var is a broader, sometimes contractor-inclusive allowlist for dashboard
// access; this list is specifically "this is Magic Engine itself" for the
// purpose of excluding ME staff from acting as a client's own confirmer.
const ME_COMPANY_DOMAINS = ['magicengine.com.au', 'magicengine.cloud']

/**
 * True when `email` belongs to Magic Engine itself — the admin list, a known
 * company domain, or a scoped demo account (`DEMO_ADMINS`). A client's
 * knowledge-confirmation must come from someone at the client, never from
 * anyone on this list, no matter who registered them (design §9.14-B: "确认
 * 人邮箱若命中任何 ME 身份...一律拒绝登记").
 */
export function isMeIdentityEmail(email: string): boolean {
  const normalised = normaliseEmail(email)

  if (isGlobalKnowledgeAdmin(normalised)) return true

  if (ME_COMPANY_DOMAINS.some((domain) => normalised.endsWith('@' + domain))) return true

  const adminDomain = process.env.ADMIN_EMAIL_DOMAIN
  if (adminDomain && normalised.endsWith('@' + adminDomain.toLowerCase().trim())) return true

  const demoAdmins = process.env.DEMO_ADMINS ?? ''
  const demoEmails = demoAdmins
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split(':')[0]?.toLowerCase().trim())
  if (demoEmails.includes(normalised)) return true

  return false
}

export interface ConfirmerEligibility {
  ok: boolean
  reason?: 'not_global_admin' | 'confirmer_is_me_identity'
}

/**
 * Whether `registeredByEmail` (a would-be global admin) may register
 * `confirmerEmail` as the client's own knowledge-confirmation contact.
 * Pure identity check — does not touch the database, does not know whether
 * the registration already exists (that's a uniqueness concern, enforced by
 * the `idx_knowledge_confirmers_active` index).
 *
 * There is no separate "registrant == confirmer" check here: the registrant
 * must pass `isGlobalKnowledgeAdmin` (an ME identity) and the confirmer must
 * fail `isMeIdentityEmail` (a non-ME identity) — the two conditions can
 * never both hold for the same email, so an explicit equality check would be
 * dead code. The database's `registrant_not_confirmer` constraint stays as
 * defense-in-depth against a direct-SQL bypass of this function.
 */
export function checkConfirmerEligibility(
  registeredByEmail: string,
  confirmerEmail: string,
): ConfirmerEligibility {
  if (!isGlobalKnowledgeAdmin(registeredByEmail)) {
    return { ok: false, reason: 'not_global_admin' }
  }
  if (isMeIdentityEmail(confirmerEmail)) {
    return { ok: false, reason: 'confirmer_is_me_identity' }
  }
  return { ok: true }
}
