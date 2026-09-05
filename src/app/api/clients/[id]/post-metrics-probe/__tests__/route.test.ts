/**
 * 探针路由的判据锁死。
 *
 * 探针本身不修不写；这些测试守两件事：
 *  1. Meta 的**每一种**返回都归到消费者设计要处理的具体一类，绝不塌成「模糊出错」。
 *  2. `shares` 缺席 vs 「读不到」是两件事 —— 缺席是「零次分享」，读不到是权限降级。
 */

import { describe, it, expect } from 'vitest'
import {
  classifyGraphError,
  readSharesField,
  readSummaryField,
  verdictFor,
  type FieldStatus,
} from '../route'

describe('classifyGraphError — 每个 Meta 错误码都归到一类', () => {
  it.each([
    [190, 'token_invalid'],
    [200, 'permission_missing'],
    [10, 'permission_missing'],
    [100, 'post_not_found'],
    [803, 'post_not_found'],
    [4, 'rate_limited'],
    [17, 'rate_limited'],
    [341, 'rate_limited'],
    [1, 'other'], // 陌生码不许当成 permission_missing / transient
  ])('code %i → %s', (code, classification) => {
    expect(classifyGraphError({ code, message: 'x' })?.classification).toBe(classification)
  })

  it('保留原始 message 和 subcode 便于回读，不吞', () => {
    const g = classifyGraphError({ code: 100, error_subcode: 33, message: 'Unsupported post request.', type: 'OAuthException' })
    expect(g).toMatchObject({
      code: 100,
      subcode: 33,
      type: 'OAuthException',
      message: 'Unsupported post request.',
      classification: 'post_not_found',
    })
  })
})

describe('readSummaryField — reactions/comments 三种可能各归一类', () => {
  it('summary.total_count 是数字 → ok(value)', () => {
    expect(readSummaryField({ summary: { total_count: 42 } })).toEqual({ kind: 'ok', value: 42 })
  })

  it('🔴 有对象但缺 total_count → field_absent，不许猜 0', () => {
    const res = readSummaryField({ summary: { total_count: 'oops' } })
    expect(res.kind).toBe('field_absent')
  })

  it('对象完全没有 summary → field_absent', () => {
    expect(readSummaryField({}).kind).toBe('field_absent')
  })

  it('字段本身没有（Meta 省略）→ field_absent（reactions/comments 意味着降级）', () => {
    expect(readSummaryField(undefined).kind).toBe('field_absent')
  })
})

describe('readSharesField — shares 独立处理（缺席 = 零次）', () => {
  it('{count: N} → ok(N)', () => {
    expect(readSharesField({ count: 3 })).toEqual({ kind: 'ok', value: 3 })
  })

  it('🔴 undefined → unshared_zero，不能塌成 field_absent', () => {
    // Meta 对没有分享过的帖子直接省略 shares 字段；那是「零次分享」的正常表达，
    // 不是权限问题。塌成 field_absent 会让上游误报「设计要处理的降级」。
    expect(readSharesField(undefined)).toEqual({ kind: 'unshared_zero' })
    expect(readSharesField(null)).toEqual({ kind: 'unshared_zero' })
  })

  it('返回了对象但缺 count → field_absent（真正的降级）', () => {
    const res = readSharesField({})
    expect(res.kind).toBe('field_absent')
  })
})

describe('verdictFor — 三个字段 + 错误分类 → 上游能拿去决策的 verdict', () => {
  const ok: FieldStatus = { kind: 'ok', value: 1 }
  const abs: FieldStatus = { kind: 'field_absent', raw: {} }
  const uz: FieldStatus = { kind: 'unshared_zero' }

  it('三个都读出数字 → all_ok', () => {
    expect(verdictFor({ graph_error: null, reactions: ok, comments: ok, shares: ok })).toBe('all_ok')
  })

  it('reactions/comments 齐、shares 缺席 → shares_missing_ok（正常情况）', () => {
    expect(verdictFor({ graph_error: null, reactions: ok, comments: ok, shares: uz })).toBe('shares_missing_ok')
  })

  it('🔴 只要有字段返回对象但缺 total_count → permission_downgrade（不能塌成 all_ok）', () => {
    expect(verdictFor({ graph_error: null, reactions: abs, comments: ok, shares: ok })).toBe('permission_downgrade')
  })

  it('🔴 权限缺 / 帖子没了 / 令牌坏 → blocked，绝不 transient', () => {
    for (const c of ['permission_missing', 'post_not_found', 'token_invalid'] as const) {
      expect(
        verdictFor({
          graph_error: { code: 1, subcode: null, type: null, message: 'x', classification: c },
          reactions: null,
          comments: null,
          shares: null,
        }),
      ).toBe('blocked')
    }
  })

  it('限流 / 网络 / 5xx → transient，交给消费者退避重试', () => {
    for (const c of ['rate_limited', 'server_error', 'network_error'] as const) {
      expect(
        verdictFor({
          graph_error: { code: 1, subcode: null, type: null, message: 'x', classification: c },
          reactions: null,
          comments: null,
          shares: null,
        }),
      ).toBe('transient')
    }
  })

  it('陌生分类 other 视为 blocked —— 保守，不让未知错误进入无限重试', () => {
    expect(
      verdictFor({
        graph_error: { code: 1, subcode: null, type: null, message: 'x', classification: 'other' },
        reactions: null,
        comments: null,
        shares: null,
      }),
    ).toBe('blocked')
  })
})
