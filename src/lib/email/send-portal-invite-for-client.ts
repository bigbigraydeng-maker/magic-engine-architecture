/**
 * One-shot orchestrator for "adding a user to a client sends them an invite":
 *   1. Ask Supabase for a one-time hashed token (invite, with magiclink fallback
 *      for already-registered users) — see generateInviteLink.
 *   2. Build our own landing URL (/auth/invite-landing?token_hash=…&type=…)
 *      so the invitee's first click hits our server route which trades the
 *      token for a session and redirects into their workspace.
 *   3. Send a Chinese welcome email via Resend — see sendPortalInvite.
 *
 * Extracted so a future "resend invite" button (or any other caller) doesn't
 * end up as a third slightly-different copy.
 *
 * Best-effort at every step: any failure returns {sent:false, reason:...}.
 * The DB row that triggered this is not touched — the caller writes it first
 * and re-sends the invite later if needed.
 */
import { supabaseAdmin } from '@/lib/supabase'
import { generateInviteLink } from '@/lib/auth/generate-invite-link'
import { sendPortalInvite } from '@/lib/email/portal-invite'

export interface SendInviteArgs {
  email: string
  clientId: string
  clientName: string
  displayName: string
}

export interface SendInviteResult {
  sent: boolean
  reason?: string
}

export async function sendPortalInviteForClient(args: SendInviteArgs): Promise<SendInviteResult> {
  const appUrl = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  if (!appUrl) {
    return { sent: false, reason: 'APP_URL not configured' }
  }

  try {
    // Supabase generateLink validates redirectTo against the project's Auth
    // Redirect Allow-List BEFORE it will mint hashed_token. Only /auth/callback
    // is on the recorded production allow-list; passing our newer
    // /auth/invite-landing would 400 and leave the invitee with a DB row but
    // no email. We ask Supabase to *nominally* redirect to the allowlisted
    // callback, then throw away the returned action_link and build our OWN
    // /auth/invite-landing?...&client_id=... URL from properties.hashed_token
    // for the email. The callback URL never actually loads — the invitee
    // hits our route directly — but the allow-list check on generateLink
    // passes.
    const linkResult = await generateInviteLink(args.email, `${appUrl}/auth/callback`, {
      client: supabaseAdmin,
    })
    if (!linkResult.ok || !linkResult.hashedToken || !linkResult.type) {
      return { sent: false, reason: linkResult.reason ?? 'no hashed_token' }
    }

    const landing = new URL(`${appUrl}/auth/invite-landing`)
    landing.searchParams.set('token_hash', linkResult.hashedToken)
    landing.searchParams.set('type', linkResult.type)
    landing.searchParams.set('client_id', args.clientId)

    return await sendPortalInvite({
      email: args.email,
      clientName: args.clientName,
      displayName: args.displayName,
      actionLink: landing.toString(),
    })
  } catch (err: unknown) {
    return { sent: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
