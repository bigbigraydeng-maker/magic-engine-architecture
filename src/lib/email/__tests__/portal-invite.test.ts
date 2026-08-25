import { describe, it, expect } from 'vitest'
import { sendPortalInvite, type EmailSender } from '../portal-invite'

function captureSender(): { sender: EmailSender; sent: Array<Parameters<EmailSender['send']>[0]> } {
  const sent: Array<Parameters<EmailSender['send']>[0]> = []
  const sender: EmailSender = {
    async send(params) {
      sent.push(params)
      return {}
    },
  }
  return { sender, sent }
}

describe('sendPortalInvite', () => {
  it('refuses to send when neither an API key nor an injected sender is available', async () => {
    const { RESEND_API_KEY } = process.env
    delete process.env.RESEND_API_KEY
    try {
      const result = await sendPortalInvite({
        email: 'staff@cts.co.nz',
        clientName: 'CTS Tours NZ',
        accessType: 'portal',
        appUrl: 'https://magicengine.cloud',
      })
      expect(result.sent).toBe(false)
      expect(result.reason).toMatch(/RESEND_API_KEY/)
    } finally {
      if (RESEND_API_KEY) process.env.RESEND_API_KEY = RESEND_API_KEY
    }
  })

  it('sends portal-tier invitees to /portal/login', async () => {
    const { sender, sent } = captureSender()
    const result = await sendPortalInvite(
      {
        email: 'staff@cts.co.nz',
        clientName: 'CTS Tours NZ',
        displayName: '小李',
        accessType: 'portal',
        appUrl: 'https://magicengine.cloud/',
      },
      { sender },
    )
    expect(result.sent).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('staff@cts.co.nz')
    expect(sent[0].text).toContain('https://magicengine.cloud/portal/login')
    expect(sent[0].html).toContain('https://magicengine.cloud/portal/login')
    expect(sent[0].subject).toContain('CTS Tours NZ')
    expect(sent[0].text).toContain('CTS Tours NZ')
    expect(sent[0].text).toContain('小李')
    // The invite must show the invitee which email to use for OTP.
    expect(sent[0].text).toContain('staff@cts.co.nz')
  })

  it('sends dashboard-tier invitees (incl. self_serve) to /login, not /portal/login', async () => {
    // self_serve is classified as a /dashboard user by tierForAccessType —
    // routing it to /portal/login would land them in the wrong shell.
    const { sender, sent } = captureSender()
    for (const accessType of ['dashboard', 'fde', 'both', 'client', 'self_serve'] as const) {
      sent.length = 0
      const result = await sendPortalInvite(
        {
          email: 'op@cts.co.nz',
          clientName: 'CTS Tours NZ',
          accessType,
          appUrl: 'https://magicengine.cloud',
        },
        { sender },
      )
      expect(result.sent).toBe(true)
      expect(sent[0].text).toContain('https://magicengine.cloud/login')
      expect(sent[0].text).not.toContain('/portal/login')
    }
  })

  it('propagates Resend errors as sent:false with the reason', async () => {
    const sender: EmailSender = {
      async send() {
        return { error: 'domain not verified' }
      },
    }
    const result = await sendPortalInvite(
      {
        email: 'staff@cts.co.nz',
        clientName: 'CTS Tours NZ',
        accessType: 'portal',
        appUrl: 'https://magicengine.cloud',
      },
      { sender },
    )
    expect(result.sent).toBe(false)
    expect(result.reason).toBe('domain not verified')
  })

  it('escapes HTML in client name and display name to avoid injection', async () => {
    const { sender, sent } = captureSender()
    await sendPortalInvite(
      {
        email: 'x@y.com',
        clientName: '<script>alert(1)</script>',
        displayName: '"O\'Neil"',
        accessType: 'portal',
        appUrl: 'https://magicengine.cloud',
      },
      { sender },
    )
    expect(sent[0].html).not.toContain('<script>alert(1)</script>')
    expect(sent[0].html).toContain('&lt;script&gt;')
    expect(sent[0].html).toContain('&quot;O&#39;Neil&quot;')
  })

  it('strips CRLF from client name in the Subject line to block header injection', async () => {
    const { sender, sent } = captureSender()
    await sendPortalInvite(
      {
        email: 'x@y.com',
        clientName: 'CTS Tours NZ\r\nBcc: attacker@evil.com',
        accessType: 'portal',
        appUrl: 'https://magicengine.cloud',
      },
      { sender },
    )
    // The real attack surface is CRLF — without a newline the extra "Bcc:"
    // characters can't be spliced into a new SMTP header, they're just text
    // in the subject line.
    expect(sent[0].subject).not.toMatch(/[\r\n]/)
    expect(sent[0].subject).toContain('CTS Tours NZ')
  })

  it('falls back to email in the greeting when display name is blank or whitespace', async () => {
    const { sender, sent } = captureSender()
    await sendPortalInvite(
      {
        email: 'staff@cts.co.nz',
        clientName: 'CTS Tours NZ',
        displayName: '   ',
        accessType: 'portal',
        appUrl: 'https://magicengine.cloud',
      },
      { sender },
    )
    // First line of the body is the greeting — should carry the email, not the whitespace.
    expect(sent[0].text.split('\n')[0]).toContain('staff@cts.co.nz')
  })

  it('rejects an empty appUrl instead of building a bare-path login link', async () => {
    const { sender } = captureSender()
    const result = await sendPortalInvite(
      {
        email: 'x@y.com',
        clientName: 'CTS Tours NZ',
        accessType: 'portal',
        appUrl: '',
      },
      { sender },
    )
    expect(result.sent).toBe(false)
    expect(result.reason).toMatch(/appUrl/)
  })
})
