/**
 * GEO Module v1 端到端 + 五段链落点 + 变异证据（Issue #879 / WP05）。
 */

import { describe, it, expect } from 'vitest'
import {
  runGeoModule,
  GeoModuleTenantError,
  type GeoObservationRecord,
} from '../pipeline'
import {
  validateGrowthEvidence,
  validateGrowthFinding,
  validateGrowthPrescription,
  validateGrowthActionCandidate,
  validateGrowthVerificationDefinition,
  type GrowthActionCandidate,
  type GrowthFinding,
} from '@/lib/growth'
import { GEO_QUALIFIED_MENTION_FINDING_REF } from '../finding'
import { buildQualifiedMentionVerification } from '../verification'
import type { PageOptimizationIntent } from '@/lib/page-optimization'
import { makeObservation, makeEvidence, ownedCitation, romanLedgerPages, ROMAN_CLIENT_ID, ROMAN_ENTITY_PROFILE } from './fixtures'

const NO_QUESTION = { known: false, reason: 'not_recorded_by_source' } as const

/** Roman 基线现实：答案带 owned 引用、正文无合格提及。 */
function citationOnlyRecord(id: string, queryKey: string): GeoObservationRecord {
  return {
    observation: makeObservation({ id, query_key: queryKey }),
    evidence: makeEvidence({
      id: `ev-${id}`,
      observation_id: id,
      raw_response: 'To buy property in Auckland, New Zealand, consult a licensed real estate agent.',
      citations: [ownedCitation()] as never,
    }),
    questionText: NO_QUESTION,
  }
}

const groundedIntents: readonly PageOptimizationIntent[] = [
  {
    field: 'meta_title',
    proposedValue: 'Roman Hu — Auckland Real Estate Agent | Buy & Sell Homes',
    semanticIntent: { known: true, value: '让 AI 答案能把 Roman 作为奥克兰地产人识别' },
  },
]

describe('端到端：Roman 基线证据 + 台账页 → 合法 PageOptimizationRequest', () => {
  const out = runGeoModule({
    clientId: ROMAN_CLIENT_ID,
    records: [citationOnlyRecord('obs-a', 'q1'), citationOnlyRecord('obs-b', 'q2')],
    entityProfile: ROMAN_ENTITY_PROFILE,
    brandAliases: [],
    ledgerPages: romanLedgerPages(),
    target: { pageUrl: 'https://romanhu.com/about', intents: groundedIntents },
  })

  it('产出 ok=true 且请求合法', () => {
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.request.clientId).toBe(ROMAN_CLIENT_ID)
    expect(out.request.page.url).toBe('https://romanhu.com/about')
    expect(out.request.lineage.findingRefs).toEqual([GEO_QUALIFIED_MENTION_FINDING_REF])
    // 只改了 meta_title → 另两字段进 doNotTouch
    expect(out.request.constraints.doNotTouch).toEqual(['meta_description', 'content_html'])
    // 三档判据齐全
    expect(validateGrowthVerificationDefinition(out.request.verification).ok).toBe(true)
  })

  it('五段链落点齐全，各段自校验通过', () => {
    if (!out.ok) throw new Error('expected ok')
    const { chain } = out
    expect(chain.evidence.length).toBe(2)
    expect(validateGrowthEvidence(chain.evidence[0]).ok).toBe(true)
    expect(validateGrowthFinding(chain.finding).ok).toBe(true)
    expect(validateGrowthPrescription(chain.prescription).ok).toBe(true)
    expect(validateGrowthActionCandidate(chain.candidate).ok).toBe(true)
    // finding 是 AI 可见度缺口（无合格提及 → high）
    expect(chain.finding?.pillar).toBe('ai_visibility')
    expect(chain.finding?.severity).toBe('high')
    expect(chain.coverage.qualifiedMentionQueries).toBe(0)
    expect(chain.coverage.queryCount).toBe(2)
  })

  it('候选身份是 {domain,intent} 结构，且不含 risk/approved/actionKey 等夹带', () => {
    if (!out.ok) throw new Error('expected ok')
    const cand = out.chain.candidate as GrowthActionCandidate
    expect(cand.identity).toEqual({ domain: 'geo', intent: 'optimize_page_answerability' })
    expect(Object.keys(cand)).toEqual(['identity', 'input', 'basis', 'expectedImpact', 'cost', 'verification'])
  })
})

describe('诚实 defer', () => {
  it('全部观测失败（全 defer）→ 不建缺口 finding → defer（读不出≠确认缺席）', () => {
    // 🔴 修正后：全 defer 时可解释 query=0，不产出高危缺口 finding，整体 defer。
    const out = runGeoModule({
      clientId: ROMAN_CLIENT_ID,
      records: [
        {
          observation: makeObservation({ id: 'f1', outcome_ok: false, error_code: 'timeout', error_message: 'x', error_message_unknown_reason: null }),
          evidence: null,
          questionText: NO_QUESTION,
        },
      ],
      entityProfile: ROMAN_ENTITY_PROFILE,
      brandAliases: [],
      ledgerPages: romanLedgerPages(),
      target: { pageUrl: 'https://romanhu.com/about', intents: groundedIntents },
    })
    expect(out.ok).toBe(false)
    if (!out.ok && out.disposition === 'defer') {
      expect(out.reason).toBe('no_evidence_for_finding')
      expect(out.chain.finding).toBeNull()
      expect(out.chain.coverage.fullyDeferredQueries).toBe(1)
      expect(out.chain.coverage.interpretableQueries).toBe(0)
    } else {
      throw new Error('expected defer')
    }
  })

  it('目标页不在本租户台账 → defer unattributable_page，不落到别处', () => {
    const out = runGeoModule({
      clientId: ROMAN_CLIENT_ID,
      records: [citationOnlyRecord('obs-a', 'q1')],
      entityProfile: ROMAN_ENTITY_PROFILE,
      brandAliases: [],
      ledgerPages: romanLedgerPages(),
      target: { pageUrl: 'https://not-in-ledger.example/x', intents: groundedIntents },
    })
    expect(out.ok).toBe(false)
    if (!out.ok && out.disposition === 'defer') {
      expect(out.reason).toBe('unattributable_page')
      // 链仍带到 prescription，供审阅
      expect(out.chain.prescription).not.toBeNull()
      expect(out.chain.candidate).toBeNull()
    } else {
      throw new Error('expected defer')
    }
  })

  it('无字段提案 → defer unattributable_proposed_value，不硬造文案', () => {
    const out = runGeoModule({
      clientId: ROMAN_CLIENT_ID,
      records: [citationOnlyRecord('obs-a', 'q1')],
      entityProfile: ROMAN_ENTITY_PROFILE,
      brandAliases: [],
      ledgerPages: romanLedgerPages(),
      target: { pageUrl: 'https://romanhu.com/about', intents: [] },
    })
    expect(out.ok).toBe(false)
    if (!out.ok && out.disposition === 'defer') expect(out.reason).toBe('unattributable_proposed_value')
    else throw new Error('expected defer')
  })
})

describe('读侧租户隔离（fail-closed）', () => {
  it('观测行属于别的租户 → 抛 GeoModuleTenantError', () => {
    expect(() =>
      runGeoModule({
        clientId: ROMAN_CLIENT_ID,
        records: [
          {
            observation: makeObservation({ id: 'x', client_id: 'someone-else' }),
            evidence: makeEvidence({ observation_id: 'x' }),
            questionText: NO_QUESTION,
          },
        ],
        entityProfile: ROMAN_ENTITY_PROFILE,
        brandAliases: [],
        ledgerPages: romanLedgerPages(),
        target: { pageUrl: 'https://romanhu.com/about', intents: groundedIntents },
      }),
    ).toThrow(GeoModuleTenantError)
  })

  it('证据行属于别的租户 → 抛', () => {
    expect(() =>
      runGeoModule({
        clientId: ROMAN_CLIENT_ID,
        records: [
          {
            observation: makeObservation({ id: 'x' }),
            evidence: makeEvidence({ observation_id: 'x', client_id: 'someone-else' }),
            questionText: NO_QUESTION,
          },
        ],
        entityProfile: ROMAN_ENTITY_PROFILE,
        brandAliases: [],
        ledgerPages: romanLedgerPages(),
        target: { pageUrl: 'https://romanhu.com/about', intents: groundedIntents },
      }),
    ).toThrow(GeoModuleTenantError)
  })

  it('别的租户台账页即使 URL 相同也解析不到（页按 clientId 过滤）', () => {
    const out = runGeoModule({
      clientId: ROMAN_CLIENT_ID,
      records: [citationOnlyRecord('obs-a', 'q1')],
      entityProfile: ROMAN_ENTITY_PROFILE,
      brandAliases: [],
      ledgerPages: [{ client_id: 'someone-else', url: 'https://romanhu.com/about' }],
      target: { pageUrl: 'https://romanhu.com/about', intents: groundedIntents },
    })
    expect(out.ok).toBe(false)
    if (!out.ok && out.disposition === 'defer') expect(out.reason).toBe('unattributable_page')
    else throw new Error('expected defer')
  })
})

describe('变异证据：故意破坏每条不变量，断言校验器变红', () => {
  it('删「finding≥1证据」→ validateGrowthFinding 拒', () => {
    const bad: GrowthFinding = {
      pillar: 'ai_visibility',
      severity: 'high',
      statement: 'x',
      evidence: [], // 变异：抽掉证据
    }
    expect(validateGrowthFinding(bad).ok).toBe(false)
  })

  it('删 cost 上界（spendsMoney=true 却无 ceiling）→ validateGrowthActionCandidate fail-closed', () => {
    const base = runGeoModule({
      clientId: ROMAN_CLIENT_ID,
      records: [citationOnlyRecord('obs-a', 'q1')],
      entityProfile: ROMAN_ENTITY_PROFILE,
      brandAliases: [],
      ledgerPages: romanLedgerPages(),
      target: { pageUrl: 'https://romanhu.com/about', intents: groundedIntents },
    })
    if (!base.ok) throw new Error('expected ok')
    const cand = base.chain.candidate as GrowthActionCandidate
    // 合法候选先应通过
    expect(validateGrowthActionCandidate(cand).ok).toBe(true)
    // 变异：改成会花钱却说不出上界
    const mutated = { ...cand, cost: { spendsMoney: true, ceilingUsd: { known: false, reason: 'not_applicable' } } }
    expect(validateGrowthActionCandidate(mutated).ok).toBe(false)
  })

  it('not_comparable 只能进 indeterminate，不进 failure（判据文本自带约束）', () => {
    const v = buildQualifiedMentionVerification()
    expect(v.criteria.indeterminate).toContain('not_comparable')
    expect(v.criteria.failure).not.toContain('not_comparable')
  })

  it('citation-only 当 mention = 假阳：解释器判它 not qualified，不许翻成 mention', () => {
    const out = runGeoModule({
      clientId: ROMAN_CLIENT_ID,
      records: [citationOnlyRecord('obs-a', 'q1')],
      entityProfile: ROMAN_ENTITY_PROFILE,
      brandAliases: [],
      ledgerPages: romanLedgerPages(),
      target: { pageUrl: 'https://romanhu.com/about', intents: groundedIntents },
    })
    if (!out.ok) throw new Error('expected ok')
    expect(out.chain.coverage.qualifiedMentionQueries).toBe(0)
    // 🔴 直接锁 citation 闸：实体只在 owned 引用里、正文无名字 → entityMatch 必是 citation_only。
    //    （不是靠「qualified===false」这种被回显闸遮蔽的影子断言。）
    expect(out.chain.interpretations[0].entityMatch.kind).toBe('citation_only')
    expect(out.chain.interpretations[0].qualifiedMention.qualified).toBe(false)
  })
})
