/**
 * 计划组装 / 复核 / 哈希（Issue #930）。
 */

import { describe, expect, it } from 'vitest'
import {
  InventoryPlanError,
  applyReviewDecisions,
  buildInventoryPlan,
  computePlanHash,
  verifyPlanHash,
} from '../plan'
import { INVENTORY_PLAN_CONTRACT_VERSION, NORMALIZATION_RULE_VERSION } from '../types'
import type { CanonicalInventoryPlan } from '../types'

const CLIENT = '00000000-0000-0000-0000-0000000000aa'
const REVIEW = { reviewedBy: 'product-owner', reviewedAt: '2026-08-12T00:00:00.000Z' }
/** 假签名：真实实现应当是带密钥的 HMAC —— 改文件的人算不出来。 */
const SIGN = (planHash: string): string => `sig:${planHash}`

function build(urls: readonly string[], hosts: readonly string[] = ['example.com']): CanonicalInventoryPlan {
  return buildInventoryPlan({
    clientId: CLIENT,
    requestedDomain: 'example.com',
    approvedHosts: hosts,
    discoveredUrls: urls,
  })
}

describe('计划组装', () => {
  it('🔴 刚生成时一条 accepted 都没有 —— 合规候选一律 pending', () => {
    const plan = build(['https://example.com/a', 'https://example.com/b'])
    expect(plan.counts.accepted).toBe(0)
    expect(plan.counts.pending).toBe(2)
    expect(plan.candidates.every((c) => c.decision === 'pending')).toBe(true)
  })

  it('带上契约版本与规则版本', () => {
    const plan = build(['https://example.com/a'])
    expect(plan.contractVersion).toBe(INVENTORY_PLAN_CONTRACT_VERSION)
    expect(plan.normalizationRuleVersion).toBe(NORMALIZATION_RULE_VERSION)
  })

  it('规则拒掉的候选**留在计划里**并带原因码，不是悄悄丢掉', () => {
    const plan = build([
      'https://example.com/ok',
      'http://example.com/insecure',
      'https://www.example.com/other-host',
      'garbage',
    ])
    expect(plan.counts.discovered).toBe(4)
    const codes = Object.fromEntries(plan.candidates.map((c) => [c.originalUrl, c.reasonCodes]))
    expect(codes['http://example.com/insecure']).toEqual(['insecure_scheme'])
    expect(codes['https://www.example.com/other-host']).toEqual(['host_not_approved'])
    expect(codes['garbage']).toEqual(['malformed_url'])
  })

  it('撞车的候选按字典序留第一条，其余记 duplicate 并指回去', () => {
    const plan = build([
      'https://example.com/a/',
      'https://example.com/a#top',
      'https://example.com/a?utm_source=x',
    ])
    const primaries = plan.candidates.filter((c) => c.decision === 'pending')
    expect(primaries).toHaveLength(1)
    expect(primaries[0].canonicalUrl).toBe('https://example.com/a')
    const dupes = plan.candidates.filter((c) => c.reasonCodes.includes('duplicate_canonical_target'))
    expect(dupes).toHaveLength(2)
    expect(dupes.every((d) => d.duplicateOf === primaries[0].originalUrl)).toBe(true)
  })

  it('撞车主候选与发现顺序无关（哈希才可能稳定）', () => {
    const urls = ['https://example.com/a/', 'https://example.com/a#top', 'https://example.com/b']
    const a = build(urls)
    const b = build([...urls].reverse())
    expect(a.planHash).toBe(b.planHash)
  })

  it('原始串重复只算一条候选', () => {
    const plan = build(['https://example.com/a', 'https://example.com/a', ' https://example.com/a '])
    expect(plan.counts.discovered).toBe(1)
  })

  it('缺租户 / 缺域名 / 主机清单非法都直接抛', () => {
    const base = { requestedDomain: 'example.com', approvedHosts: ['example.com'], discoveredUrls: [] }
    expect(() => buildInventoryPlan({ ...base, clientId: ' ' })).toThrow(InventoryPlanError)
    expect(() => buildInventoryPlan({ ...base, clientId: CLIENT, requestedDomain: '' })).toThrow(InventoryPlanError)
    expect(() => buildInventoryPlan({ ...base, clientId: CLIENT, approvedHosts: [] })).toThrow()
  })
})

describe('计划哈希', () => {
  it('同样输入 → 同一个哈希；自校验通过', () => {
    const a = build(['https://example.com/a', 'https://example.com/b'])
    const b = build(['https://example.com/b', 'https://example.com/a'])
    expect(a.planHash).toBe(b.planHash)
    expect(verifyPlanHash(a)).toBe(true)
  })

  it.each([
    ['改决策', (p: CanonicalInventoryPlan) => ({ ...p, candidates: p.candidates.map((c) => ({ ...c, decision: 'defer' as const })) })],
    ['改 canonical', (p: CanonicalInventoryPlan) => ({ ...p, candidates: p.candidates.map((c) => ({ ...c, canonicalUrl: 'https://example.com/hacked' })) })],
    ['改租户', (p: CanonicalInventoryPlan) => ({ ...p, clientId: 'other-tenant' })],
    ['改批准主机', (p: CanonicalInventoryPlan) => ({ ...p, boundary: { ...p.boundary, approvedHosts: ['example.com', 'www.example.com'] } })],
    ['改规则版本', (p: CanonicalInventoryPlan) => ({ ...p, normalizationRuleVersion: 'inventory-url-rules@0' })],
    ['改复核签名', (p: CanonicalInventoryPlan) => ({ ...p, review: { reviewedBy: 'someone-else', reviewedAt: REVIEW.reviewedAt } })],
  ])('批准后被%s → 哈希对不上', (_label, mutate) => {
    const plan = build(['https://example.com/a'])
    const reviewed = applyReviewDecisions(plan, {
      decisions: { 'https://example.com/a': { decision: 'accepted' } },
      review: REVIEW,
      sign: SIGN,
    })
    expect(verifyPlanHash(mutate(reviewed))).toBe(false)
  })

  it('哈希覆盖原因码与备注（不只是 URL 清单）', () => {
    const plan = build(['https://example.com/a'])
    const tampered = {
      ...plan,
      candidates: plan.candidates.map((c) => ({ ...c, notes: [...c.notes, 'fragment_removed' as const] })),
    }
    expect(computePlanHash(tampered)).not.toBe(plan.planHash)
  })
})

describe('人工复核', () => {
  it('决策落到候选上，计数与哈希跟着变', () => {
    const plan = build(['https://example.com/a', 'https://example.com/b', 'https://example.com/c'])
    const reviewed = applyReviewDecisions(plan, {
      decisions: {
        'https://example.com/a': { decision: 'accepted' },
        'https://example.com/b': { decision: 'rejected' },
        'https://example.com/c': { decision: 'defer' },
      },
      review: REVIEW,
      sign: SIGN,
    })
    expect(reviewed.counts).toMatchObject({ accepted: 1, rejected: 1, deferred: 1, pending: 0 })
    expect(reviewed.planHash).not.toBe(plan.planHash)
    expect(verifyPlanHash(reviewed)).toBe(true)
    expect(reviewed.review.reviewedBy).toBe('product-owner')
  })

  it('人工拒 / 暂缓自动补机器可读原因码', () => {
    const plan = build(['https://example.com/a', 'https://example.com/b'])
    const reviewed = applyReviewDecisions(plan, {
      decisions: {
        'https://example.com/a': { decision: 'rejected' },
        'https://example.com/b': { decision: 'defer' },
      },
      review: REVIEW,
      sign: SIGN,
    })
    const codes = Object.fromEntries(reviewed.candidates.map((c) => [c.originalUrl, c.reasonCodes]))
    expect(codes['https://example.com/a']).toEqual(['reviewer_rejected'])
    expect(codes['https://example.com/b']).toEqual(['reviewer_deferred'])
  })

  it('🔴 规则自动拒掉的候选不许被人改成 accepted', () => {
    const plan = build(['https://www.example.com/x'])
    expect(() =>
      applyReviewDecisions(plan, {
        decisions: { 'https://www.example.com/x': { decision: 'accepted' } },
        review: REVIEW,
        sign: SIGN,
      }),
    ).toThrow(/不接受人工覆盖/)
  })

  it('决策指向不存在的候选 → 抛（防止复核文件与计划脱节）', () => {
    const plan = build(['https://example.com/a'])
    expect(() =>
      applyReviewDecisions(plan, {
        decisions: { 'https://example.com/typo': { decision: 'accepted' } },
        review: REVIEW,
        sign: SIGN,
      }),
    ).toThrow(InventoryPlanError)
  })

  it('没判到的候选留在 pending（漏判不会被当成拒绝）', () => {
    const plan = build(['https://example.com/a', 'https://example.com/b'])
    const reviewed = applyReviewDecisions(plan, {
      decisions: { 'https://example.com/a': { decision: 'accepted' } },
      review: REVIEW,
      sign: SIGN,
    })
    expect(reviewed.counts.pending).toBe(1)
  })

  it('🔴 计划在外面被改过（canonical 换成同主机下的另一页）→ 不许盖章', () => {
    const plan = build(['https://example.com/a'])
    const tampered = {
      ...plan,
      candidates: plan.candidates.map((c) => ({ ...c, canonicalUrl: 'https://example.com/hacked' })),
    }
    // 连哈希一起重算，模拟「改完再自洽」的情形 —— 只验哈希是拦不住的。
    const { planHash: _drop, ...rest } = tampered
    const rehashed = { ...rest, planHash: computePlanHash(rest) }
    expect(() =>
      applyReviewDecisions(rehashed, {
        decisions: { 'https://example.com/a': { decision: 'accepted' } },
        review: REVIEW,
        sign: SIGN,
      }),
    ).toThrow(/不是机器刚产出的那一份/)
  })

  it('计划哈希对不上 → 不许盖章（不给任意输入重新背书）', () => {
    const plan = build(['https://example.com/a'])
    const tampered = { ...plan, clientId: 'someone-else' }
    expect(() => applyReviewDecisions(tampered, { decisions: {}, review: REVIEW, sign: SIGN })).toThrow(/哈希对不上/)
  })

  it('旧规则版本生成的计划 → 不许被悄悄「升级」成当前规则', () => {
    const plan = build(['https://example.com/a'])
    const old = { ...plan, normalizationRuleVersion: 'inventory-url-rules@0' }
    const { planHash: _drop, ...rest } = old
    const rehashed = { ...rest, planHash: computePlanHash(rest) }
    expect(() => applyReviewDecisions(rehashed, { decisions: {}, review: REVIEW, sign: SIGN })).toThrow(/规则变了/)
  })

  it('🔴 计划里预置了 accepted（哈希也重算过）→ 不许盖章', () => {
    // Codex 第四轮点名的那条：把合规候选的 decision 从 pending 直接改成 accepted、
    // 再用公开的 computePlanHash 重算，版本/哈希/canonical 推导三关全过；
    // 然后 applyReviewDecisions(..., decisions: {}) 会原样保留它并盖上签名 ——
    // 最终写入一条复核人从没接受过的页面。
    const plan = build(['https://example.com/a', 'https://example.com/b'])
    const preAccepted = {
      ...plan,
      candidates: plan.candidates.map((c) =>
        c.originalUrl === 'https://example.com/a' ? { ...c, decision: 'accepted' as const } : c,
      ),
    }
    const { planHash: _drop, ...rest } = preAccepted
    const rehashed = { ...rest, planHash: computePlanHash(rest) }
    expect(() => applyReviewDecisions(rehashed, { decisions: {}, review: REVIEW, sign: SIGN })).toThrow(
      /不是机器刚产出的那一份/,
    )
  })

  it('原因码 / 归一留痕 / 撞车指向被改过 → 同样不许盖章', () => {
    const plan = build(['https://example.com/a/', 'https://example.com/a#x'])
    for (const mutate of [
      (c: (typeof plan.candidates)[number]) => ({ ...c, reasonCodes: [] as never[] }),
      (c: (typeof plan.candidates)[number]) => ({ ...c, notes: [] as never[] }),
      (c: (typeof plan.candidates)[number]) => ({ ...c, duplicateOf: 'https://example.com/elsewhere' }),
    ]) {
      const tampered = {
        ...plan,
        candidates: plan.candidates.map((c) => (c.decision === 'rejected' ? mutate(c) : c)),
      }
      const { planHash: _drop, ...rest } = tampered
      expect(() =>
        applyReviewDecisions({ ...rest, planHash: computePlanHash(rest) }, { decisions: {}, review: REVIEW, sign: SIGN }),
      ).toThrow(/不是机器刚产出的那一份/)
    }
  })

  it('同一条原始 URL 出现两次 → 不许盖章（机器不会这么生成）', () => {
    const plan = build(['https://example.com/a'])
    const doubled = { ...plan, candidates: [...plan.candidates, { ...plan.candidates[0] }] }
    const { planHash: _drop, ...rest } = doubled
    expect(() =>
      applyReviewDecisions({ ...rest, planHash: computePlanHash(rest) }, { decisions: {}, review: REVIEW, sign: SIGN }),
    ).toThrow(/出现了多次/)
  })

  it('🔴 已经签过名的计划不许再盖一次章', () => {
    const plan = build(['https://example.com/a'])
    const reviewed = applyReviewDecisions(plan, {
      decisions: { 'https://example.com/a': { decision: 'rejected' } },
      review: REVIEW,
      sign: SIGN,
    })
    expect(() =>
      applyReviewDecisions(reviewed, {
        decisions: {},
        review: { reviewedBy: 'someone-else', reviewedAt: REVIEW.reviewedAt },
        sign: SIGN,
      }),
    ).toThrow(/只盖一次章/)
  })

  it('🔴 决策值拼错（accept 少个 ed）→ 当场抛，不许带着签名往下走', () => {
    // 决策是从文件 / 界面反序列化进来的，联合类型在运行时不拦任何东西。
    // 放过去它就从 accepted/rejected/deferred/pending 每一份账里消失，
    // 而只要还有另一条合法 accepted，整次激活会写完其余页面然后报「完成」。
    const plan = build(['https://example.com/a', 'https://example.com/b'])
    expect(() =>
      applyReviewDecisions(plan, {
        decisions: {
          'https://example.com/a': { decision: 'accept' as never },
          'https://example.com/b': { decision: 'accepted' },
        },
        review: REVIEW,
        sign: SIGN,
      }),
    ).toThrow(/只接受 accepted \/ rejected \/ defer/)
  })

  it('复核必须署名并带时间', () => {
    const plan = build(['https://example.com/a'])
    expect(() =>
      applyReviewDecisions(plan, { decisions: {}, review: { reviewedBy: '  ', reviewedAt: REVIEW.reviewedAt }, sign: SIGN }),
    ).toThrow(InventoryPlanError)
    expect(() =>
      applyReviewDecisions(plan, { decisions: {}, review: { reviewedBy: 'x', reviewedAt: '' }, sign: SIGN }),
    ).toThrow(InventoryPlanError)
  })
})
