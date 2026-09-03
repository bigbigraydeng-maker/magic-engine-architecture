/**
 * 「客人来信没人回」汇总邮件的测试。
 *
 * 钉住的都是「错了会伤到人」的地方，不是好看的排版：
 *   · 测试标记必须在主题和正文第一段 —— 收信的是客户的销售，不是 ME 内部人
 *   · 收件人没配就退回 ME 自己的信箱 —— 猜客户地址 = 把客人名单发给外人
 *   · 没配 key 不许抛 —— 上游那趟同步不该被发信拖崩
 *   · 链接必须是绝对网址 —— 相对路径在邮件里点开就是死链（2026-08-05 实测过）
 *   · 正文不许出现邮箱 —— 邮件会被转发，别顺手把客人联系方式带出去
 */

import { describe, expect, it, vi } from 'vitest'
import {
  DIGEST_TEST_PREFIX,
  buildDigestBody,
  buildDigestSubject,
  humanWait,
  sendEmailReplyDigest,
  type DigestMailer,
  type DigestItem,
} from '../email-reply-digest'
import type { ReplyDueItem } from '../email-reply-due'
import { ME_MAIL_TO_ADDRESS } from '@/lib/email/sender'

const NOW = new Date('2026-09-03T12:00:00Z')

function item(over: Partial<DigestItem> = {}): DigestItem {
  return {
    clientId: 'c0000000-0000-0000-0000-000000000000',
    contactId: 'p1',
    displayName: '王女士',
    subject: '想问 9 月的团还有位子吗',
    lastMessageAt: '2026-09-02T12:00:00Z', // 24 小时前
    ...over,
  }
}

/** 假发信通道：只记参数，绝不真发。 */
function fakeMailer(result: { error: unknown } = { error: null }) {
  const send = vi.fn().mockResolvedValue(result)
  const mailer: DigestMailer = { emails: { send } }
  return { mailer, send }
}

describe('主题 —— PM 硬性要求带测试标记', () => {
  it('以【测试功能】开头', () => {
    const subject = buildDigestSubject('CTS Tours', 3)
    expect(subject.startsWith(DIGEST_TEST_PREFIX)).toBe(true)
    expect(DIGEST_TEST_PREFIX).toBe('【测试功能】')
  })

  it('一眼看得出是谁、有几封', () => {
    const subject = buildDigestSubject('CTS Tours', 3)
    expect(subject).toContain('CTS Tours')
    expect(subject).toContain('3')
  })
})

describe('正文', () => {
  it('第一段就说清这是测试功能、不对请直接回复', () => {
    const html = buildDigestBody('CTS Tours', [item()], NOW)
    const firstParagraph = html.slice(0, html.indexOf('</p>'))
    expect(firstParagraph).toContain(DIGEST_TEST_PREFIX)
    expect(firstParagraph).toContain('测试')
    expect(firstParagraph).toContain('直接回复这封邮件')
  })

  it('链接是绝对网址，不是相对路径', () => {
    const html = buildDigestBody('CTS Tours', [item()], NOW)
    const hrefs = (html.match(/href="[^"]+"/g) ?? []).map((m) => m.slice(6, -1))
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) {
      expect(href.startsWith('https://')).toBe(true)
      expect(() => new URL(href)).not.toThrow()
    }
    expect(hrefs[0]).toContain('/dashboard/clients/c0000000-0000-0000-0000-000000000000/crm/all?contact=p1')
  })

  it('按等了多久从长到短排', () => {
    const html = buildDigestBody(
      'CTS Tours',
      [
        item({ contactId: 'p-short', displayName: '刚等两天的', lastMessageAt: '2026-09-01T12:00:00Z' }),
        item({ contactId: 'p-long', displayName: '等最久的', lastMessageAt: '2026-08-25T12:00:00Z' }),
        item({ contactId: 'p-mid', displayName: '中间的', lastMessageAt: '2026-08-30T12:00:00Z' }),
      ],
      NOW,
    )
    expect(html.indexOf('等最久的')).toBeLessThan(html.indexOf('中间的'))
    expect(html.indexOf('中间的')).toBeLessThan(html.indexOf('刚等两天的'))
    expect(html).toContain('1. 等最久的')
  })

  it('等待时长说人话', () => {
    const html = buildDigestBody('CTS Tours', [item({ lastMessageAt: '2026-09-01T09:00:00Z' })], NOW)
    expect(html).toContain('已经等了 2 天 3 小时')
  })

  it('不把客人的邮箱写进正文', () => {
    const html = buildDigestBody('CTS Tours', [item(), item({ contactId: 'p2', displayName: '李先生' })], NOW)
    expect(html).not.toContain('@')
  })

  it('🔴 display_name 本身就是一个邮箱时也不许原样漏出去', () => {
    // Outlook 在对方没设显示名时把 from.emailAddress.name 填成地址本身，
    // 于是 contacts.display_name 常常就是一个邮箱（mail-graph.ts:68）。
    // 这封信会被转发，地址不能跟着出去 —— 但也不能全抹成「未留姓名」，
    // 那样一整批人长得一模一样，销售认不出该先回谁。
    const html = buildDigestBody(
      'CTS Tours',
      [
        item({ displayName: 'wang.customer@gmail.com' }),
        item({ contactId: 'p2', displayName: '李先生 <li@outlook.com>' }),
      ],
      NOW,
    )
    expect(html).not.toContain('@')
    expect(html).toContain('wang.customer')
    expect(html).toContain('李先生')
  })

  it('客人名字和主题里的尖括号会被转义，不会破坏排版', () => {
    const html = buildDigestBody('CTS Tours', [item({ displayName: '<b>假粗体</b>', subject: 'a & b' })], NOW)
    expect(html).toContain('&lt;b&gt;假粗体&lt;/b&gt;')
    expect(html).toContain('a &amp; b')
  })

  it('没名字 / 没主题也照样列出来，不显示 null', () => {
    const html = buildDigestBody('CTS Tours', [item({ displayName: null, subject: null })], NOW)
    expect(html).toContain('未留姓名')
    expect(html).toContain('（这封信没有主题）')
    expect(html).not.toContain('null')
    expect(html).not.toContain('undefined')
  })

  it('上游 pickReplyDue 挑出来的条目可以原样传进来', () => {
    // email-reply-due.ts 的 ReplyDueItem 多带 conversationId / waitingHours，
    // 字段名对齐后不需要中间翻译层。这里钉住这个契约，改字段名会当场红。
    const upstream: ReplyDueItem = {
      clientId: 'c1',
      contactId: 'p9',
      conversationId: 'conv-1',
      displayName: '陈先生',
      subject: '行程能改日期吗',
      lastMessageAt: '2026-09-01T12:00:00Z',
      waitingHours: 48,
    }
    const html = buildDigestBody('CTS Tours', [upstream], NOW)
    expect(html).toContain('陈先生')
    expect(html).toContain('已经等了 2 天')
  })

  it('时间戳坏掉的照样出现在名单上，只是排最后', () => {
    const html = buildDigestBody(
      'CTS Tours',
      [item({ contactId: 'bad', displayName: '时间坏了的', lastMessageAt: 'not-a-date' }), item()],
      NOW,
    )
    expect(html).toContain('时间坏了的')
    expect(html).toContain('时间不详')
    expect(html).not.toContain('NaN')
    expect(html.indexOf('王女士')).toBeLessThan(html.indexOf('时间坏了的'))
  })
})

describe('🔴 数字不许说小', () => {
  it('有被压掉的条目时，正文说的是总数并且点名还有几封没列出来', () => {
    const html = buildDigestBody('CTS Tours', [item()], NOW, { dropped: 15 })
    // 名单上 1 条 + 压掉 15 条 = 16，不能只说 1
    expect(html).toContain('有 16 封客人来信在等回复')
    expect(html).toContain('15')
    expect(html).toContain('没有列在上面')
  })

  it('没被压掉时不出现那句话，也不多算数字', () => {
    const html = buildDigestBody('CTS Tours', [item()], NOW)
    expect(html).toContain('有 1 封客人来信在等回复')
    expect(html).not.toContain('没有列在上面')
  })

  it('主题里的数字也是总数 —— 销售先看到的是它', async () => {
    const { mailer, send } = fakeMailer()
    await sendEmailReplyDigest('CTS Tours', [item()], {
      apiKey: 'test-key',
      now: NOW,
      dropped: 24,
      mailerFactory: () => mailer,
    })
    expect(send.mock.calls[0][0].subject).toBe(buildDigestSubject('CTS Tours', 25))
  })

  it('邮箱没同步上时，名单前面先说这份名单不完整', () => {
    const html = buildDigestBody('CTS Tours', [item()], NOW, { syncStale: true })
    expect(html).toContain('这份名单今天不完整')
    // 警告必须在名单**前面**，否则等于没警告
    expect(html.indexOf('这份名单今天不完整')).toBeLessThan(html.indexOf('王女士'))
  })

  it('同步正常时不吓唬人', () => {
    expect(buildDigestBody('CTS Tours', [item()], NOW)).not.toContain('这份名单今天不完整')
  })
})

describe('humanWait', () => {
  it.each([
    [30 * 60_000, '不到 1 小时'],
    [3 * 3_600_000, '3 小时'],
    [26 * 3_600_000, '1 天 2 小时'],
    [48 * 3_600_000, '2 天'],
    [Number.NaN, '时间不详'],
  ])('%s 毫秒 → %s', (ms, expected) => {
    expect(humanWait(ms)).toBe(expected)
  })
})

describe('发送 —— 安全第一，永不抛', () => {
  it('没配收件人时退回 ME 自己的信箱，绝不猜客户地址', async () => {
    const { mailer, send } = fakeMailer()
    const r = await sendEmailReplyDigest('CTS Tours', [item()], {
      apiKey: 'test-key',
      now: NOW,
      mailerFactory: () => mailer,
    })
    expect(r.sent).toBe(true)
    expect(r.recipients).toEqual([ME_MAIL_TO_ADDRESS])
    expect(send.mock.calls[0][0].to).toEqual([ME_MAIL_TO_ADDRESS])
  })

  it('传了空数组也走 fallback', async () => {
    const { mailer } = fakeMailer()
    const r = await sendEmailReplyDigest('CTS Tours', [item()], {
      apiKey: 'test-key',
      recipients: [],
      mailerFactory: () => mailer,
    })
    expect(r.recipients).toEqual([ME_MAIL_TO_ADDRESS])
  })

  it('调用方给了收件人就用它', async () => {
    const { mailer, send } = fakeMailer()
    const to = ['lisa@example.com', 'baker@example.com']
    const r = await sendEmailReplyDigest('CTS Tours', [item()], {
      apiKey: 'test-key',
      recipients: to,
      mailerFactory: () => mailer,
    })
    expect(r.recipients).toEqual(to)
    expect(send.mock.calls[0][0].to).toEqual(to)
  })

  it('发出去的主题和正文带测试标记', async () => {
    const { mailer, send } = fakeMailer()
    await sendEmailReplyDigest('CTS Tours', [item()], {
      apiKey: 'test-key',
      now: NOW,
      mailerFactory: () => mailer,
    })
    const payload = send.mock.calls[0][0]
    expect(payload.subject.startsWith(DIGEST_TEST_PREFIX)).toBe(true)
    expect(payload.html).toContain(DIGEST_TEST_PREFIX)
  })

  it('没有 API key → 不发不抛，说清原因', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const { mailer, send } = fakeMailer()
    const r = await sendEmailReplyDigest('CTS Tours', [item()], { mailerFactory: () => mailer })
    expect(r).toEqual({ sent: false, reason: 'RESEND_API_KEY 未配置', recipients: [ME_MAIL_TO_ADDRESS] })
    expect(send).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })

  it('零条目 → 一封都不发', async () => {
    const { mailer, send } = fakeMailer()
    const r = await sendEmailReplyDigest('CTS Tours', [], {
      apiKey: 'test-key',
      mailerFactory: () => mailer,
    })
    expect(r).toEqual({ sent: false, reason: '无待回邮件', recipients: [ME_MAIL_TO_ADDRESS] })
    expect(send).not.toHaveBeenCalled()
  })

  it('发信服务报错 → 返回原因，不抛', async () => {
    const { mailer } = fakeMailer({ error: { statusCode: 403, name: 'validation_error', message: '域名没验证' } })
    const r = await sendEmailReplyDigest('CTS Tours', [item()], {
      apiKey: 'test-key',
      mailerFactory: () => mailer,
    })
    expect(r.sent).toBe(false)
    expect(r.reason).toContain('域名没验证')
  })

  it('发信通道直接抛异常 → 也吞掉，返回结构化结果', async () => {
    const r = await sendEmailReplyDigest('CTS Tours', [item()], {
      apiKey: 'test-key',
      mailerFactory: () => {
        throw new Error('网络断了')
      },
    })
    expect(r).toEqual({ sent: false, reason: '网络断了', recipients: [ME_MAIL_TO_ADDRESS] })
  })
})
