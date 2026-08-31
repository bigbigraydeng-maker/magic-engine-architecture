/**
 * Portal / dashboard invite email — sent when an admin adds someone to
 * client_portal_users. Without this, adding a row is silent and the invitee
 * has no idea an account exists for them.
 *
 * The email carries a one-time Supabase auth link. Clicking it drops the
 * invitee straight into an authenticated session on the client's workspace —
 * no login form, no password to set. See generate-invite-link.ts for the link.
 * Runs best-effort: a send failure never rolls back the DB insert (the row is
 * already valid; the invite can be re-sent).
 *
 * All copy is in Chinese by product convention.
 */
import { Resend } from 'resend'
import { meMailFrom } from '@/lib/email/sender'

export interface PortalInviteInput {
  email: string
  clientName: string
  displayName?: string | null
  /** One-time Supabase auth link that lands the invitee in a session. */
  actionLink: string
}

export interface PortalInviteResult {
  sent: boolean
  reason?: string
}

/** Strip CRLF from anything that lands in an email header — a client name with
 *  a stray newline would let an attacker splice extra headers. */
function sanitizeHeader(s: string, maxLen = 120): string {
  return s.replace(/[\r\n]+/g, ' ').trim().slice(0, maxLen)
}

function subjectFor(clientName: string): string {
  // Keep the leader tight so Gmail/Outlook (~70 char clip on mobile) still
  // shows the client name — the piece that lets the invitee recognise it.
  return `Magic Engine 邀请：进入 ${sanitizeHeader(clientName)} 工作台`
}

function renderText(input: PortalInviteInput): string {
  const who = input.displayName?.trim() || input.email
  return [
    `${who}，你好：`,
    '',
    `你已被加入 Magic Engine 的 ${input.clientName} 工作台。`,
    '',
    '点这个链接直接进入你的工作台，无需注册、无需密码：',
    input.actionLink,
    '',
    '说明：',
    '- 这个链接一次性有效，请从收到这封邮件的浏览器打开',
    '- 进入后不用设置密码。以后再登录时，去登录页输入这个邮箱，收 6 位验证码即可',
    '',
    '有问题可以直接回这封邮件。',
    '',
    '— Magic Engine',
  ].join('\n')
}

function renderHtml(input: PortalInviteInput): string {
  const who = escapeHtml(input.displayName?.trim() || input.email)
  const clientName = escapeHtml(input.clientName)
  const link = escapeHtml(input.actionLink)
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#2a2a2a;line-height:1.6;max-width:560px;margin:0 auto;padding:24px">
<p>${who}，你好：</p>
<p>你已被加入 <strong>Magic Engine</strong> 的 <strong>${clientName}</strong> 工作台。</p>
<p style="margin:24px 0">
  <a href="${link}" style="display:inline-block;background:#B8863A;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">进入我的工作台 →</a>
</p>
<p style="color:#666;font-size:13px">或者直接复制这个一次性链接到浏览器：<br><span style="word-break:break-all;color:#B8863A">${link}</span></p>
<p style="color:#666;font-size:13px;margin-top:24px">
说明：<br>
· 这个链接一次性有效，请从收到这封邮件的浏览器打开<br>
· 进入后不用设置密码；以后再登录时，去登录页输入这个邮箱，收 6 位验证码即可
</p>
<p style="color:#888;font-size:13px;margin-top:32px">有问题可以直接回这封邮件。<br>— Magic Engine</p>
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

  if (!input.actionLink) {
    return { sent: false, reason: 'actionLink is required' }
  }

  const sender: EmailSender = deps.sender ?? new ResendSender(apiKey!)

  const { error } = await sender.send({
    from: meMailFrom('Magic Engine'),
    to: input.email,
    subject: subjectFor(input.clientName),
    text: renderText(input),
    html: renderHtml(input),
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
