/**
 * Ask Supabase for a one-time hashed token that the invitee can trade for
 * a session — with NO login form, NO password to set, NO PKCE handshake
 * (the invitee never had a chance to seed a code_verifier cookie).
 *
 * We do NOT hand the raw Supabase `action_link` back — that URL hits the
 * Supabase verify endpoint which then redirects to `redirect_to` with only
 * a `#access_token=...` hash. A server-side callback can't read the hash.
 *
 * Instead we return the raw `hashed_token` + `verification_type` so the
 * caller can build its own landing URL (e.g. /auth/invite-landing) that
 * calls `verifyOtp({token_hash, type})` server-side. See the invite-landing
 * route for the other side of this contract.
 *
 * Falls back to a magiclink token when Supabase says the user is already
 * registered — some invitees already exist as auth users from another
 * client or from self_serve signup, and `invite` refuses on them.
 */
export interface InviteLinkResult {
  ok: boolean
  hashedToken?: string
  /**
   * The EmailOtpType to pass into `verifyOtp` on the landing side. Sourced
   * from Supabase's OWN `properties.verification_type` on the generateLink
   * response — NOT the `type` we requested. GoTrue does not always mint a
   * token whose verification type matches the request (e.g. an
   * already-registered-user `magiclink` request has been observed minting a
   * token that GoTrue only accepts back under a different type string).
   * Falls back to the requested type when Supabase's response omits the
   * field, so older/mocked responses keep working.
   */
  type?: string
  /** Set when ok:false — safe-to-log message describing what failed. */
  reason?: string
}

interface GenerateLinkParams {
  type: 'invite' | 'magiclink'
  email: string
  options: { redirectTo: string }
}

interface GenerateLinkResponse {
  data: { properties?: { hashed_token?: string; verification_type?: string } | null } | null
  error: { message?: string; status?: number; code?: string } | null
}

export interface InviteLinkAdmin {
  generateLink(params: GenerateLinkParams): Promise<GenerateLinkResponse>
}

export interface InviteLinkDeps {
  client: { auth: { admin: InviteLinkAdmin } }
}

function extractHash(properties: unknown): string | undefined {
  if (properties && typeof properties === 'object') {
    const t = (properties as { hashed_token?: unknown }).hashed_token
    if (typeof t === 'string' && t.length > 0) return t
  }
  return undefined
}

// GoTrue reports the type it will actually accept back in verifyOtp via
// `properties.verification_type` — trust that over the `type` we asked
// generateLink for, which is not guaranteed to match (see InviteLinkResult).
function extractVerificationType(properties: unknown): string | undefined {
  if (properties && typeof properties === 'object') {
    const t = (properties as { verification_type?: unknown }).verification_type
    if (typeof t === 'string' && t.length > 0) return t
  }
  return undefined
}

function isAlreadyRegistered(err: { message?: string; status?: number; code?: string } | null): boolean {
  if (!err) return false
  // Prefer the structured code when Supabase returns it (new API).
  if (err.code === 'email_exists' || err.code === 'user_already_exists') return true
  // Fall back to substring match. Requiring the word "regist" / "exists" avoids
  // treating a bare 422 (which Supabase also uses for bad email format,
  // signup disabled, or rate limit) as an already-registered user.
  const msg = err.message?.toLowerCase() ?? ''
  return /already\s+(registered|been\s+registered|exists)/.test(msg) || /already\s+in\s+use/.test(msg)
}

export async function generateInviteLink(
  email: string,
  redirectTo: string,
  deps: InviteLinkDeps,
): Promise<InviteLinkResult> {
  const admin = deps.client.auth.admin

  const invite = await admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo },
  })

  const inviteHash = extractHash(invite.data?.properties)
  if (!invite.error && inviteHash) {
    return {
      ok: true,
      hashedToken: inviteHash,
      type: extractVerificationType(invite.data?.properties) ?? 'invite',
    }
  }

  if (isAlreadyRegistered(invite.error)) {
    const magic = await admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo },
    })
    const magicHash = extractHash(magic.data?.properties)
    if (!magic.error && magicHash) {
      return {
        ok: true,
        hashedToken: magicHash,
        type: extractVerificationType(magic.data?.properties) ?? 'magiclink',
      }
    }
    return {
      ok: false,
      reason: magic.error?.message ?? 'magiclink returned no hashed_token',
    }
  }

  return {
    ok: false,
    reason: invite.error?.message ?? 'invite returned no hashed_token',
  }
}
