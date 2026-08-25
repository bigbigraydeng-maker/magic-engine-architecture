/**
 * Portal / dashboard invite email — sent when an admin adds someone to
 * client_portal_users. Without this, adding a row is silent and the invitee
 * has no idea an account exists for them — PM had to hand-notify each user
 * with the login URL. Runs best-effort: a send failure never rolls back the
 * DB insert (the row is already valid; the invite can be re-sent).
 *
 * All copy is in Chinese by product convention. Landing target is `/portal/login`
 * for portal tier, `/login` for dashboard/fde/client tiers — the invitee enters
 * their own email there and receives a 6-digit code via signInWithOtp.
 */
import { Resend } from 'resend'
import { tierForAccessType, type AccessType } from '@/lib/auth/access-types'
import { meMailFrom } from '@/lib/email/sender'

export interface PortalInviteInput {
  email: string
  clientName: string
  displayName?: string | null
  accessType: AccessType
  appUrl: string
}

export interface PortalInviteResult {
  sent: boolean
  reason?: string
}

function loginPathForAccessType(accessType: AccessType): string {
  // Delegated to tierForAccessType so a new access_type only needs classifying
  // in one place. self_serve is a /dashboard user per access-types.ts, so only
  // the portal_only tier goes to /portal/login. Both endpoints ultimately call
  // the same signInWithOtp flow.
  return tierForAccessType(accessType) === 'portal_only' ? '/portal/login' : '/login'
}

/** Strip CRLF from anything that lands in an email header — a client name with
 *  a stray newline would let an attacker splice extra headers. */
function sanitizeHeader(s: string, maxLen = 120): string {
  return s.replace(/[\r\n]+/g, ' ').trim().slice(0, maxLen)
}

function subjectFor(clientName: string): string {
  return `你被邀请加入 Magic Engine 的 ${sanitizeHeader(clientName)} 工作台`
}

function renderText(input: PortalInviteInput, loginUrl: string): string {
  const who = input.displayName?.trim() || input.email
  return [
    `${who}，你好：`,
    '',
    `你已被加入 Magic Engine 的 ${input.clientName} 工作台。`,
    '',
    '登录方式：',
    `1. 打开 ${loginUrl}`,
    `2. 输入这个邮箱 ${input.email}`,
    '3. 收一封 6 位验证码，输入即可进入',
    '',
    '登录后你会自动进入 ' + input.clientName + ' 的工作台。有问题可以直接回这封邮件。',
    '',
    '— Magic Engine',
  ].join('\n')
}

function renderHtml(input: PortalInviteInput, loginUrl: string): string {
  const who = escapeHtml(input.displayName?.trim() || input.email)
  const clientName = escapeHtml(input.clientName)
  const emailEsc = escapeHtml(input.email)
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#2a2a2a;line-height:1.6;max-width:560px;margin:0 auto;padding:24px">
<p>${who}，你好：</p>
<p>你已被加入 <strong>Magic Engine</strong> 的 <strong>${clientName}</strong> 工作台。</p>
<p><strong>登录方式：</strong></p>
<ol>
<li>打开 <a href="${escapeHtml(loginUrl)}" style="color:#B8863A">${escapeHtml(loginUrl)}</a></li>
<li>输入这个邮箱 <code>${emailEsc}</code></li>
<li>收一封 6 位验证码，输入即可进入</li>
</ol>
<p>登录后你会自动进入 ${clientName} 的工作台。有问题可以直接回这封邮件。</p>
<p style="color:#888;font-size:13px;margin-top:32px">— Magic Engine</p>
</body></html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function sendPortalInvite(
  input: PortalInviteInput,
  deps: { resendApiKey?: string; sender?: EmailSender } = {},
): Promise<PortalInviteResult> {
  const apiKey = deps.resendApiKey ?? process.env.RESEND_API_KEY
  if (!apiKey && !deps.sender) {
    return { sent: false, reason: 'RESEND_API_KEY not configured' }
  }

  const appUrl = input.appUrl.replace(/\/$/, '')
  if (!appUrl) return { sent: false, reason: 'appUrl is required' }

  const loginUrl = `${appUrl}${loginPathForAccessType(input.accessType)}`
  const sender: EmailSender = deps.sender ?? new ResendSender(apiKey!)

  const { error } = await sender.send({
    from: meMailFrom('Magic Engine'),
    to: input.email,
    subject: subjectFor(input.clientName),
    text: renderText(input, loginUrl),
    html: renderHtml(input, loginUrl),
  })

  if (error) return { sent: false, reason: error }
  return { sent: true }
}

// ── Sender abstraction so tests can assert without hitting Resend ───────────

export interface EmailSender {
  send(params: {
    from: string
    to: string
    subject: string
    text: string
    html: string
  }): Promise<{ error?: string }>
}

class ResendSender implements EmailSender {
  private readonly client: Resend
  constructor(apiKey: string) {
    this.client = new Resend(apiKey)
  }
  async send(params: {
    from: string
    to: string
    subject: string
    text: string
    html: string
  }): Promise<{ error?: string }> {
    const { error } = await this.client.emails.send(params)
    if (error) return { error: error.message ?? String(error) }
    return {}
  }
}
