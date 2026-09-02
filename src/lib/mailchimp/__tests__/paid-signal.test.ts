/**
 * 「这个人的钱到账了没有」——判据的回归测试。
 *
 * 语料全部取自 info@ctstours.co.nz 2026-09-02 的真实邮件，一个字没改。
 * 最要命的一条是 `Payment of Invoice` 那封：它是**催款**，长得却跟收款几乎
 * 一模一样。判错的代价不是脏数据，是把一个正在谈的客人标成已付款、停掉他所有
 * 跟进邮件 —— 这单就丢了。所以催款那几条用 🔴 标出来，它们比正例更重要。
 */

import { describe, expect, it } from 'vitest'
import { readPaidSignal, evidenceIsVerbatim, looksLikeCustomerAddress } from '../paid-signal'

// ── 真实语料 ────────────────────────────────────────────────────────────────

/** Baker 发给 Nikki Smith 的确认信（Sent Items, 2026-09-01 11:02）。 */
const REAL_CONFIRM =
  'Fw: New Reborn Lead: Nikki Smith — still_deciding_—_show_me_all_4 ' +
  'Hi Nikki Your payment has been received in full. Thank you so much. Cheers! Baker'

/** 🔴 发给 Lorraine 的催款信（Sent Items, 2026-09-01 11:01）—— 她还没付。 */
const REAL_CHASING =
  'Payment of Invoice - Best of China Tour ' +
  'Dear Lorraine, Please find the credit card payment link below: ' +
  'https://gateway-app.latipay.net/payment-me'

/** 收款后发行程（Sent Items, 2026-09-02 18:51）。 */
const REAL_THANKS =
  'China Discovery Best of China | November ' +
  'Hi Lorraine, Thank you again for the payment. Please received the itinerary with flight details'

/** 客人发来的付款确认（Inbox, 2026-08-27）。 */
const REAL_INBOUND = 'Payment confirmation Get Outlook for Android'

describe('readPaidSignal · 我们自己确认收款', () => {
  it('真实语料：「Your payment has been received in full」→ confirmed', () => {
    const v = readPaidSignal({ text: REAL_CONFIRM, direction: 'outbound' })
    expect(v.kind).toBe('confirmed')
    if (v.kind === 'confirmed') {
      expect(v.evidence.toLowerCase()).toContain('payment has been received')
      expect(evidenceIsVerbatim(v.evidence, REAL_CONFIRM)).toBe(true)
    }
  })

  it('真实语料：「Thank you again for the payment」→ confirmed', () => {
    const v = readPaidSignal({ text: REAL_THANKS, direction: 'outbound' })
    expect(v.kind).toBe('confirmed')
  })

  it('同一封信里客人复述「payment has been received」→ 不算数（只认 outbound）', () => {
    // 客人转发我们的确认信回来，方向是 inbound —— 不能因此打标签
    const v = readPaidSignal({ text: REAL_CONFIRM, direction: 'inbound' })
    expect(v.kind).not.toBe('confirmed')
  })
})

describe('readPaidSignal · 🔴 催款不能当成付款', () => {
  it('🔴 真实语料：「please find the credit card payment link」→ chasing，绝不是 confirmed', () => {
    const v = readPaidSignal({ text: REAL_CHASING, direction: 'outbound' })
    expect(v.kind).toBe('chasing')
  })

  it('🔴 主题里有 payment、正文在催 → 仍是 chasing', () => {
    const v = readPaidSignal({
      text: 'Payment of Invoice please make payment before 30 September',
      direction: 'outbound',
    })
    expect(v.kind).toBe('chasing')
  })

  it('🔴 「awaiting payment」→ chasing', () => {
    expect(readPaidSignal({ text: 'Still awaiting payment for this booking', direction: 'outbound' }).kind)
      .toBe('chasing')
  })

  it('定金收到了、尾款还在催 → confirmed（他确实付过定金，判定顺序不能反）', () => {
    const v = readPaidSignal({
      text: 'Your deposit has been received. For the balance please find the payment link below',
      direction: 'outbound',
    })
    expect(v.kind).toBe('confirmed')
  })
})

describe('readPaidSignal · 客人自己说付了 → 只到 needs_review', () => {
  it('真实语料：客人主题「Payment confirmation」→ needs_review，不自动打标签', () => {
    const v = readPaidSignal({ text: REAL_INBOUND, direction: 'inbound', hasAttachment: true })
    expect(v.kind).toBe('needs_review')
  })

  it('「I have transferred the deposit」→ needs_review', () => {
    const v = readPaidSignal({ text: 'Hi, I have transferred the deposit today', direction: 'inbound' })
    expect(v.kind).toBe('needs_review')
  })

  it('🔴 「I\'ll transfer tomorrow」是未来式 → 什么都不算（看账不看话）', () => {
    const v = readPaidSignal({ text: "Sounds good, I'll transfer the deposit tomorrow", direction: 'inbound' })
    expect(v.kind).toBe('not_payment')
  })

  it('🔴 客人说付了，但方向标成 outbound → 也不能 confirmed', () => {
    const v = readPaidSignal({ text: 'I have paid the deposit', direction: 'outbound' })
    expect(v.kind).not.toBe('confirmed')
  })
})

describe('readPaidSignal · 无关邮件', () => {
  it('普通行程询问 → not_payment', () => {
    expect(readPaidSignal({ text: 'Can you please forward me the full itinerary', direction: 'inbound' }).kind)
      .toBe('not_payment')
  })

  it('空文本 → not_payment，不炸', () => {
    expect(readPaidSignal({ text: '', direction: 'outbound' }).kind).toBe('not_payment')
  })

  it('🔴 「booking is confirmed」不等于钱到账 → not_payment', () => {
    expect(readPaidSignal({ text: 'Your booking is confirmed for November', direction: 'outbound' }).kind)
      .toBe('not_payment')
  })
})

describe('evidenceIsVerbatim · 说不出原话就不算数', () => {
  it('原话在文里 → true', () => {
    expect(evidenceIsVerbatim('payment has been received', REAL_CONFIRM)).toBe(true)
  })

  it('🔴 编出来的句子 → false', () => {
    expect(evidenceIsVerbatim('he paid NZ$2000 last Tuesday', REAL_CONFIRM)).toBe(false)
  })

  it('空 evidence → false', () => {
    expect(evidenceIsVerbatim('   ', REAL_CONFIRM)).toBe(false)
  })
})

describe('looksLikeCustomerAddress · 别把同事标成付费客户', () => {
  it('🔴 自己人 @ctstours.co.nz → 挡掉', () => {
    expect(looksLikeCustomerAddress('info@ctstours.co.nz')).toBe(false)
    expect(looksLikeCustomerAddress('bdm@ctstours.co.nz')).toBe(false)
  })

  it('🔴 机器人地址 → 挡掉', () => {
    expect(looksLikeCustomerAddress('noreply@shopify.com')).toBe(false)
    expect(looksLikeCustomerAddress('mailer-daemon@outlook.com')).toBe(false)
  })

  it('真实客人邮箱 → 放行', () => {
    expect(looksLikeCustomerAddress('enrkay@gmail.com')).toBe(true)
    expect(looksLikeCustomerAddress('judc@xtra.co.nz')).toBe(true)
  })

  it('格式不对 / 空 → 挡掉', () => {
    expect(looksLikeCustomerAddress('')).toBe(false)
    expect(looksLikeCustomerAddress(null)).toBe(false)
    expect(looksLikeCustomerAddress('not-an-email')).toBe(false)
  })
})
