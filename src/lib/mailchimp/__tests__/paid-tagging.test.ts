/**
 * 邮件 → 标签 的编排层。
 *
 * 这里钉的是「什么时候**不做**」：催款的不碰、同事的不碰、编出来的证据不认、
 * 名单里没有的不建。做对一件事只让一个客人少收一封邮件；做错一件事会把一个
 * 正在谈的客人停掉全部跟进。
 */

import { describe, expect, it } from 'vitest'
import { runPaidTagging, DEFAULT_PAID_TAG, type CandidateMail } from '../paid-tagging'

const POLICY = { paidTag: DEFAULT_PAID_TAG, leadTagsToRemove: ['fb_lead', 'reborn_leadform'] }
const CFG_BASE = { apiKey: 'key-us19', audienceId: 'dda97b7e61' }

/** 假 Mailchimp：按「名单里有谁、他有什么标签」建模，不按调用次序。 */
function fakeMailchimp(audience: Record<string, string[]>) {
  const writes: Array<{ email: string; tags: unknown }> = []
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const hashToEmail = new Map(
      Object.keys(audience).map((e) => [require('node:crypto').createHash('md5').update(e).digest('hex'), e]),
    )
    const hash = url.split('/members/')[1]?.split(/[/?]/)[0] ?? ''
    const email = hashToEmail.get(hash)

    if (url.includes('/tags')) {
      writes.push({ email: email ?? '?', tags: JSON.parse(String(init?.body)).tags })
      return new Response(null, { status: 204 })
    }
    if (!email) return new Response(JSON.stringify({ title: 'Not Found' }), { status: 404 })
    return new Response(
      JSON.stringify({ email_address: email, status: 'subscribed', tags: audience[email].map((name) => ({ name })) }),
      { status: 200 },
    )
  }
  return { cfg: { ...CFG_BASE, fetchImpl: impl }, writes }
}

function mail(over: Partial<CandidateMail>): CandidateMail {
  return {
    id: 'm1',
    subject: null,
    preview: '',
    receivedAt: '2026-09-01T11:02:00Z',
    direction: 'outbound',
    counterparty: { address: 'enrkay@gmail.com', name: 'Nikki Smith' },
    ...over,
  }
}

describe('runPaidTagging · 自动打标签', () => {
  it('真实语料：Baker 确认收款 → 打上 paid_customer 并摘掉线索标签', async () => {
    const { cfg, writes } = fakeMailchimp({ 'enrkay@gmail.com': ['fb_lead', 'reborn_leadform'] })
    const r = await runPaidTagging(
      [mail({ subject: 'Fw: New Reborn Lead: Nikki Smith', preview: 'Hi Nikki Your payment has been received in full. Thank you so much.' })],
      cfg,
      POLICY,
    )
    expect(r.tagged).toHaveLength(1)
    expect(r.tagged[0].added).toEqual(['paid_customer'])
    expect(r.tagged[0].removed).toEqual(['fb_lead', 'reborn_leadform'])
    expect(writes).toHaveLength(1)
  })

  it('同一个人两封确认信（定金+尾款）→ 只写一次', async () => {
    const { cfg, writes } = fakeMailchimp({ 'enrkay@gmail.com': ['fb_lead'] })
    const r = await runPaidTagging(
      [
        mail({ id: 'a', preview: 'Your deposit has been received' }),
        mail({ id: 'b', preview: 'Your payment has been received in full' }),
      ],
      cfg,
      POLICY,
    )
    expect(r.tagged).toHaveLength(1)
    expect(writes).toHaveLength(1)
  })
})

describe('runPaidTagging · 🔴 什么时候不做', () => {
  it('🔴 催款邮件 → 进 chasing，绝不打标签', async () => {
    const { cfg, writes } = fakeMailchimp({ 'lorraine@example.com': ['fb_lead'] })
    const r = await runPaidTagging(
      [mail({
        subject: 'Payment of Invoice - Best of China Tour',
        preview: 'Dear Lorraine, Please find the credit card payment link below: https://gateway-app.latipay.net/payment-me',
        counterparty: { address: 'lorraine@example.com', name: 'Lorraine' },
      })],
      cfg,
      POLICY,
    )
    expect(r.tagged).toHaveLength(0)
    expect(r.chasing).toEqual(['lorraine@example.com'])
    expect(writes).toHaveLength(0)
  })

  it('🔴 收件人是自己人 → 完全跳过，不打标签也不报数', async () => {
    const { cfg, writes } = fakeMailchimp({ 'bdm@ctstours.co.nz': [] })
    const r = await runPaidTagging(
      [mail({ preview: 'Your payment has been received', counterparty: { address: 'bdm@ctstours.co.nz', name: 'BDM' } })],
      cfg,
      POLICY,
    )
    expect(r.tagged).toHaveLength(0)
    expect(writes).toHaveLength(0)
  })

  it('🔴 命中确认句但人不在 Mailchimp 名单里 → 记 notInAudience，绝不新建', async () => {
    const { cfg, writes } = fakeMailchimp({})
    const r = await runPaidTagging([mail({ preview: 'Your payment has been received in full' })], cfg, POLICY)
    expect(r.tagged).toHaveLength(0)
    expect(r.notInAudience).toEqual(['enrkay@gmail.com'])
    expect(writes).toHaveLength(0)
  })

  it('🔴 客人自己说付了 → needs_review，不自动打', async () => {
    const { cfg, writes } = fakeMailchimp({ 'enrkay@gmail.com': ['fb_lead'] })
    const r = await runPaidTagging(
      [mail({ direction: 'inbound', subject: 'Payment confirmation', preview: 'Get Outlook for Android' })],
      cfg,
      POLICY,
    )
    expect(r.tagged).toHaveLength(0)
    expect(r.needsReview).toHaveLength(1)
    expect(r.needsReview[0].email).toBe('enrkay@gmail.com')
    expect(writes).toHaveLength(0)
  })

  it('普通询价邮件 → 什么都不做', async () => {
    const { cfg, writes } = fakeMailchimp({ 'enrkay@gmail.com': [] })
    const r = await runPaidTagging(
      [mail({ direction: 'inbound', preview: 'Can you please forward me the full itinerary' })],
      cfg,
      POLICY,
    )
    expect(r.scanned).toBe(1)
    expect(r.tagged).toHaveLength(0)
    expect(r.needsReview).toHaveLength(0)
    expect(writes).toHaveLength(0)
  })
})

describe('runPaidTagging · 出错时如实报数', () => {
  it('Mailchimp 500 → 记 errors 且标可重试，不假装成功', async () => {
    const impl = async (url: string) =>
      url.includes('/tags') ? new Response(null, { status: 500 }) : new Response(
        JSON.stringify({ email_address: 'enrkay@gmail.com', status: 'subscribed', tags: [] }), { status: 200 })
    const r = await runPaidTagging(
      [mail({ preview: 'Your payment has been received in full' })],
      { ...CFG_BASE, fetchImpl: impl },
      POLICY,
    )
    expect(r.tagged).toHaveLength(0)
    expect(r.errors).toEqual([{ email: 'enrkay@gmail.com', reason: 'http_500', retryable: true }])
  })
})
