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
      }),
    ).toThrow(/不接受人工覆盖/)
  })

  it('决策指向不存在的候选 → 抛（防止复核文件与计划脱节）', () => {
    const plan = build(['https://example.com/a'])
    expect(() =>
      applyReviewDecisions(plan, {
        decisions: { 'https://example.com/typo': { decision: 'accepted' } },
        review: REVIEW,
      }),
    ).toThrow(InventoryPlanError)
  })

  it('没判到的候选留在 pending（漏判不会被当成拒绝）', () => {
    const plan = build(['https://example.com/a', 'https://example.com/b'])
    const reviewed = applyReviewDecisions(plan, {
      decisions: { 'https://example.com/a': { decision: 'accepted' } },
      review: REVIEW,
    })
    expect(reviewed.counts.pending).toBe(1)
  })

  it('复核必须署名并带时间', () => {
    const plan = build(['https://example.com/a'])
    expect(() =>
      applyReviewDecisions(plan, { decisions: {}, review: { reviewedBy: '  ', reviewedAt: REVIEW.reviewedAt } }),
    ).toThrow(InventoryPlanError)
    expect(() =>
      applyReviewDecisions(plan, { decisions: {}, review: { reviewedBy: 'x', reviewedAt: '' } }),
    ).toThrow(InventoryPlanError)
  })
})
