/**
 * Mailchimp 出口 tally 的判据 —— 这里是**唯一**事实定义，两个消费者（日报邮件、
 * PM 今日待办）都读它。判据分叉的后果很具体：邮件报了「12 条没进邮件名单」，
 * PM 打开今日待办却找不到可动手的事。
 */

import { describe, expect, it } from 'vitest'
import { countOutletGaps, isOutletGap, outletGapLabel } from '../outlet-tally'

describe('isOutletGap', () => {
  it('订阅成功不是问题', () => {
    expect(isOutletGap('subscribed')).toBe(false)
    expect(isOutletGap('already_member')).toBe(false)
  })

  it('「本来就不该进名单」的四类不算问题', () => {
    for (const k of [
      'skipped:no_email',
      'skipped:invalid_email',
      'skipped:explicit_opt_out',
      'skipped:contact_dnc',
      'skipped:no_audience_config',
      'skipped:no_audience_id',
    ]) {
      expect(isOutletGap(k), k).toBe(false)
    }
  })

  it('「我们自己坏了导致人没进去」一律算问题', () => {
    for (const k of [
      'skipped:client_config_read_failed', // 2026-08~09 那次静默事故
      'skipped:no_api_key', // 名单配了却没密钥 = 配置断了
      'skipped:bad_api_key_format',
      'skipped:dnc_check_failed', // fail-closed 是对的，但人确实没进去
      'skipped:evidence_persist_failed',
    ]) {
      expect(isOutletGap(k), k).toBe(true)
    }
  })

  it('所有 failed:* 一律算问题', () => {
    for (const k of ['failed:auth', 'failed:rate_limited', 'failed:provider_5xx']) {
      expect(isOutletGap(k), k).toBe(true)
    }
  })

  it('没见过的 skip 理由默认**算问题** —— 白名单不是黑名单，默认是说出来', () => {
    expect(isOutletGap('skipped:brand_new_reason_nobody_has_seen')).toBe(true)
    expect(isOutletGap('failed:brand_new_reason')).toBe(true)
  })
})

describe('outletGapLabel', () => {
  it('认识的 key 说人话，不把代号糊到 PM 脸上', () => {
    expect(outletGapLabel('skipped:client_config_read_failed')).toBe('读不出这个客户的邮件名单配置')
    expect(outletGapLabel('failed:auth')).toBe('Mailchimp 不认这个密钥')
  })

  it('不认识的 key 照原样带出来，绝不咽掉', () => {
    expect(outletGapLabel('failed:whatever')).toContain('failed:whatever')
  })
})

describe('countOutletGaps', () => {
  it('只数「本该进却没进」的条数', () => {
    expect(
      countOutletGaps({
        subscribed: 10,
        'skipped:no_email': 4,
        'skipped:client_config_read_failed': 3,
        'failed:auth': 2,
      }),
    ).toBe(5)
  })

  it('没有 tally / 空 tally / 计数为 0 都是 0', () => {
    expect(countOutletGaps(undefined)).toBe(0)
    expect(countOutletGaps({})).toBe(0)
    expect(countOutletGaps({ 'failed:auth': 0 })).toBe(0)
  })
})
