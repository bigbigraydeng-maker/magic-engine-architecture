/**
 * K-WP01A —— 请求体的边界。
 *
 * 🔴 请求体里能带的**只有三样**：approve/reject、看到的那份审批请求的 id、原因。
 *    操作者身份 / 客户 / 动作 / 权限档次 / 成本上限 / 政策版本一律由服务端取。
 *
 *    这里是**严格模式**：多带一个字段就 400。不是「读不到就忽略」——
 *    忽略的话，一个带着 `actorEmail` 的请求会安静地成功，
 *    而将来某个人顺手加一句 `body.actorEmail ??` 就把身份闸拆了。
 */

import { describe, it, expect } from 'vitest'
import { ApprovalError } from '../errors'
import { parseDecisionInput, MAX_REASON_LENGTH } from '../service'

const OK_ID = 'decision-abc'

function expectRejected(body: unknown, contains?: string): ApprovalError {
  let caught: unknown = null
  try {
    parseDecisionInput(body)
  } catch (e) {
    caught = e
  }
  expect(caught, `这个请求体本该被拒：${JSON.stringify(body)}`).toBeInstanceOf(ApprovalError)
  const err = caught as ApprovalError
  expect(err.code).toBe('invalid_request')
  expect(err.status).toBe(400)
  if (contains) expect(err.humanReason).toContain(contains)
  return err
}

describe('parseDecisionInput · 合法的三个字段', () => {
  it('approve 不带原因也行', () => {
    expect(parseDecisionInput({ resolution: 'approve', expectedDecisionId: OK_ID })).toEqual({
      resolution: 'approve',
      expectedDecisionId: OK_ID,
    })
  })

  it('approve 带原因就留着', () => {
    const parsed = parseDecisionInput({
      resolution: 'approve',
      expectedDecisionId: OK_ID,
      reason: '  跟客户确认过了  ',
    })
    expect(parsed.reason).toBe('跟客户确认过了')
  })

  it('reject 带原因', () => {
    expect(
      parseDecisionInput({ resolution: 'reject', expectedDecisionId: OK_ID, reason: '这周不发' }),
    ).toEqual({ resolution: 'reject', expectedDecisionId: OK_ID, reason: '这周不发' })
  })
})

describe('🔴 parseDecisionInput · 伪造身份的字段一律拒', () => {
  const FORGERIES: Array<[label: string, extra: Record<string, unknown>]> = [
    ['操作者邮箱', { actorEmail: 'attacker@evil.test' }],
    ['操作者身份（另一种拼法）', { approvedByUser: 'attacker@evil.test' }],
    ['用户对象', { user: { email: 'attacker@evil.test' } }],
    ['客户 id', { clientId: 'some-other-client' }],
    ['权限档次', { tier: 'admin' }],
    ['角色', { role: 'admin' }],
    ['动作键', { actionKey: 'seo.build_publish_package' }],
    ['成本上限', { costCapUsd: 9999 }],
    ['政策版本', { policyVersion: 1 }],
  ]

  it.each(FORGERIES)('%s 出现在请求体里 → 400', (_label, extra) => {
    const err = expectRejected(
      { resolution: 'approve', expectedDecisionId: OK_ID, ...extra },
      '不该有的字段',
    )
    expect(err.detail.unexpected as string[]).toEqual(Object.keys(extra))
  })

  it('🔴 拒绝时同样拦 —— 不能靠 reject 这条路绕过去', () => {
    expectRejected({
      resolution: 'reject',
      expectedDecisionId: OK_ID,
      reason: '不做',
      actorEmail: 'attacker@evil.test',
    })
  })
})

describe('🔴 parseDecisionInput · 其余不合法输入', () => {
  it('不是对象', () => {
    for (const body of [null, undefined, 'approve', 42, [], [{ resolution: 'approve' }]]) {
      expectRejected(body)
    }
  })

  it('resolution 只能是 approve / reject', () => {
    for (const resolution of [undefined, '', 'APPROVE', 'yes', 'deny', true, 1]) {
      expectRejected({ resolution, expectedDecisionId: OK_ID })
    }
  })

  it('🔴 缺 expectedDecisionId → 400（没有它就没法确认批的是不是他看见的那件事）', () => {
    for (const expectedDecisionId of [undefined, '', '   ', 42, null, {}]) {
      expectRejected({ resolution: 'approve', expectedDecisionId }, 'expectedDecisionId')
    }
  })

  it('🔴 reject 不写原因 → 400', () => {
    for (const reason of [undefined, '', '   ', '\n\t ']) {
      expectRejected({ resolution: 'reject', expectedDecisionId: OK_ID, reason }, '必须写一句为什么')
    }
  })

  it('reason 不是文字 → 400', () => {
    expectRejected({ resolution: 'reject', expectedDecisionId: OK_ID, reason: 123 })
  })

  it(`reason 超过 ${MAX_REASON_LENGTH} 字 → 400`, () => {
    expectRejected({
      resolution: 'reject',
      expectedDecisionId: OK_ID,
      reason: 'x'.repeat(MAX_REASON_LENGTH + 1),
    })
    // 边界上那一条要放行
    expect(
      parseDecisionInput({
        resolution: 'reject',
        expectedDecisionId: OK_ID,
        reason: 'x'.repeat(MAX_REASON_LENGTH),
      }).reason,
    ).toHaveLength(MAX_REASON_LENGTH)
  })
})
