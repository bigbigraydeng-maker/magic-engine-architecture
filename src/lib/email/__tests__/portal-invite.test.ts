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

const OK_LINK = 'https://xyz.supabase.co/auth/v1/verify?token=abc&type=invite&redirect_to=https://app.magicengine.com.au/auth/callback'

describe('sendPortalInvite', () => {
  it('refuses to send when neither an API key nor an injected sender is available', async () => {
    const { RESEND_API_KEY } = process.env
    delete process.env.RESEND_API_KEY
    try {
      const result = await sendPortalInvite({
        email: 'staff@cts.co.nz',
        clientName: 'CTS Tours NZ',
        actionLink: OK_LINK,
      })
      expect(result.sent).toBe(false)
      expect(result.reason).toMatch(/RESEND_API_KEY/)
    } finally {
      if (RESEND_API_KEY) process.env.RESEND_API_KEY = RESEND_API_KEY
    }
  })

  it('renders the one-time action link in both text and HTML bodies', async () => {
    const { sender, sent } = captureSender()
    const result = await sendPortalInvite(
      {
        email: 'staff@cts.co.nz',
        clientName: 'CTS Tours NZ',
        displayName: '小李',
        actionLink: OK_LINK,
      },
      { sender },
    )
    expect(result.sent).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('staff@cts.co.nz')
    expect(sent[0].text).toContain(OK_LINK)
    // In HTML the URL's `&` gets HTML-escaped, so match on the escaped form.
    expect(sent[0].html).toContain(OK_LINK.replace(/&/g, '&amp;'))
    expect(sent[0].subject).toContain('CTS Tours NZ')
    // Chinese copy anchors: no "sign in" / "log in", we explicitly say no password.
    expect(sent[0].text).toContain('无需注册')
    expect(sent[0].text).toContain('无需密码')
    expect(sent[0].text).toContain('小李')
  })

  it('rejects an empty actionLink instead of sending a broken invite', async () => {
    const { sender } = captureSender()
    const result = await sendPortalInvite(
      {
        email: 'x@y.com',
        clientName: 'CTS Tours NZ',
        actionLink: '',
      },
      { sender },
    )
    expect(result.sent).toBe(false)
    expect(result.reason).toMatch(/actionLink/)
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
        actionLink: OK_LINK,
      },
      { sender },
    )
    expect(result.sent).toBe(false)
    expect(result.reason).toBe('domain not verified')
  })

  it('escapes HTML in client name, display name and action link', async () => {
    const { sender, sent } = captureSender()
    await sendPortalInvite(
      {
        email: 'x@y.com',
        clientName: '<script>alert(1)</script>',
        displayName: '"O\'Neil"',
        actionLink: 'https://x.co/callback?a=1&b=2',
      },
      { sender },
    )
    expect(sent[0].html).not.toContain('<script>alert(1)</script>')
    expect(sent[0].html).toContain('&lt;script&gt;')
    expect(sent[0].html).toContain('&quot;O&#39;Neil&quot;')
    // Ampersand in URL must be escaped so the anchor href stays a single param string.
    expect(sent[0].html).toContain('a=1&amp;b=2')
  })

  it('strips CRLF from client name in the Subject line to block header injection', async () => {
    const { sender, sent } = captureSender()
    await sendPortalInvite(
      {
        email: 'x@y.com',
        clientName: 'CTS Tours NZ\r\nBcc: attacker@evil.com',
        actionLink: OK_LINK,
      },
      { sender },
    )
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
        actionLink: OK_LINK,
      },
      { sender },
    )
    expect(sent[0].text.split('\n')[0]).toContain('staff@cts.co.nz')
  })
})
