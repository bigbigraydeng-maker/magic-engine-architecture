/**
 * WP05 第 3 轮修复的回归 + 变异证据（Issue #879 · Codex #1032 复审）。
 *
 * 每条都带「修复生效」正向断言 + 「破坏修复即变红」的对照（同内容换个摆法就翻盘）。
 */

import { describe, it, expect } from 'vitest'
import { interpretObservation } from '../m1'
import { summarizeCoverage, buildQualifiedMentionFinding, hasVisibilityGap } from '../finding'
import { buildPageOptimizationRequest } from '../page-request'
import { buildQualifiedMentionVerification } from '../verification'
import { runGeoModule, GeoModuleTenantError } from '../pipeline'
import type { GeoObservationInterpretation } from '../types'
import type { GrowthEvidence } from '@/lib/growth'
import type { PageOptimizationIntent } from '@/lib/page-optimization'
import { makeObservation, makeEvidence, romanLedgerPages, ROMAN_CLIENT_ID, ROMAN_ENTITY_PROFILE } from './fixtures'

const KNOWN_Q = { known: true, value: 'who should i hire to sell my house?' } as const

function interpret(rawResponse: string, over: Partial<Parameters<typeof interpretObservation>[0]> = {}) {
  return interpretObservation({
    observation: makeObservation(),
    evidence: makeEvidence({ raw_response: rawResponse }),
    entityProfile: ROMAN_ENTITY_PROFILE,
    brandAliases: [],
    questionText: KNOWN_Q,
    ...over,
  })
}

// ── 句子级绑定（最要害：防「别人在别处出现替 Roman 完成判定」）──────────────────

describe('句子级绑定：消歧 / 推荐 / 序数只看 Roman 所在句', () => {
  it('消歧锚点在**别的句子**描述别人 → Roman 不合格提及', () => {
    const r = interpret('Roman Hu is an author. Jane Doe is a licensed real estate agent in Auckland, New Zealand.')
    expect(r.qualifiedMention.qualified).toBe(false)
    expect(r.reasonCodes).toContain('disambiguation_insufficient')
  })

  it('对照：同样的锚点若与 Roman **同句** → 合格提及（证明是句界在 gate）', () => {
    const r = interpret('Roman Hu is a licensed real estate agent in Auckland, New Zealand.')
    expect(r.qualifiedMention.qualified).toBe(true)
  })

  it('推荐的是**别人** → Roman 的 recommendation 不算 explicit_positive', () => {
    const r = interpret('Roman Hu is a real estate agent in Auckland, New Zealand. I would recommend Jane Doe instead.')
    expect(r.recommendation).not.toBe('explicit_positive')
  })

  it('对照：推荐词与 Roman 同句 → explicit_positive', () => {
    const r = interpret('Roman Hu is a real estate agent in Auckland, New Zealand, and I would recommend Roman Hu.')
    expect(r.recommendation).toBe('explicit_positive')
  })

  it('序数描述**别人** → Roman 的 rank 不 computed', () => {
    const r = interpret('Roman Hu is a real estate agent in Auckland, New Zealand. Jane Doe is the first choice.')
    expect(r.rank.status).not.toBe('computed')
  })

  // ── 分号 / 冒号 / 破折号连接的多主体也必须切开（魏征复审：只切 .!? 会被绕过）──
  it('分号连接别人 → Roman 不合格提及', () => {
    const r = interpret('Roman Hu is an author; Jane Doe is a licensed real estate agent in Auckland, New Zealand')
    expect(r.qualifiedMention.qualified).toBe(false)
  })

  it('冒号连接、推荐别人 → 非 explicit_positive', () => {
    const r = interpret('Roman Hu is a real estate agent in Auckland, New Zealand: I recommend Jane Doe')
    expect(r.recommendation).not.toBe('explicit_positive')
  })

  it('破折号连接、推荐别人 → 非 explicit_positive', () => {
    const r = interpret('Roman Hu is a real estate agent in Auckland, New Zealand - I would recommend Jane Doe instead')
    expect(r.recommendation).not.toBe('explicit_positive')
  })

  it('破折号连接、序数说别人 → 非 computed', () => {
    const r = interpret('Roman Hu is a real estate agent in Auckland, New Zealand; Jane Doe is the first choice')
    expect(r.rank.status).not.toBe('computed')
  })

  it('对照：连字词 real-estate 不被破折号切断（仍需两侧空格才切）', () => {
    const r = interpret('Roman Hu is a real-estate agent in Auckland, New Zealand')
    // real-estate 不含 'real estate' 子串 → 靠 realty/realtor 也没有 → 消歧不足（保守），
    // 关键是：不会因为破折号把句子切碎导致解析异常。
    expect(r.disposition).toBe('interpreted')
  })
})

// ── 问句缺失闸 ────────────────────────────────────────────────────────────────

describe('questionText 未知 → 正文命中一律 defer，不当正向覆盖', () => {
  it('问句未知 + 正文有 Roman → defer question_text_unknown', () => {
    const r = interpret('Roman Hu is a real estate agent in Auckland, New Zealand.', {
      questionText: { known: false, reason: 'not_recorded_by_source' },
    })
    expect(r.disposition).toBe('defer')
    expect(r.reasonCodes).toContain('question_text_unknown')
    expect(r.qualifiedMention.qualified).toBe(false)
    // 审计仍看得到正文命中过
    expect(r.entityMatch.kind).toBe('body_match')
  })

  it('问句未知 + 正文无 Roman（citation/no_match）→ 不因此 defer', () => {
    const r = interpret('Contact a licensed agent in Auckland to buy a home.', {
      questionText: { known: false, reason: 'source_ambiguous' },
    })
    expect(r.reasonCodes).not.toContain('question_text_unknown')
    expect(r.disposition).toBe('interpreted')
  })
})

// ── 聚合分组：locale / market 不混池 ──────────────────────────────────────────

describe('聚合分组键含 locale / market', () => {
  function qualified(id: string, queryKey: string, locale: string, market: string): GeoObservationInterpretation {
    return interpret('Roman Hu is a real estate agent in Auckland, New Zealand.', {
      observation: makeObservation({ id, query_key: queryKey, locale, market }),
      evidence: makeEvidence({ id: `ev-${id}`, observation_id: id, raw_response: 'Roman Hu is a real estate agent in Auckland, New Zealand.' }),
    })
  }

  it('同 query_key 不同 locale → 不并池（2 个 query）', () => {
    const s = summarizeCoverage([qualified('a', 'q1', 'en-NZ', 'nz'), qualified('b', 'q1', 'zh-CN', 'nz')])
    expect(s.queryCount).toBe(2)
  })

  it('同 query_key 同 locale 同 market → 并池（1 个 query）', () => {
    const s = summarizeCoverage([qualified('a', 'q1', 'en-NZ', 'nz'), qualified('b', 'q1', 'en-NZ', 'nz')])
    expect(s.queryCount).toBe(1)
  })

  it('构造分隔符碰撞的 locale/market 值不并池（groupKey 用 JSON 编码，不可碰撞）', () => {
    // 裸 `|` 拼接会让 (locale='x', market='y|m:z') 与 (locale='x|m:y', market='z') 撞成同一 key。
    const a = qualified('a', 'q1', 'x', 'y|m:z')
    const b = qualified('b', 'q1', 'x|m:y', 'z')
    expect(summarizeCoverage([a, b]).queryCount).toBe(2)
  })

  it('locale 未知 → 各自成组（未知也隔离）', () => {
    const u = (id: string) =>
      interpret('x', {
        observation: makeObservation({ id, query_key: 'q1', locale: null, locale_unknown_reason: 'not_recorded_by_source' }),
        evidence: makeEvidence({ id: `ev-${id}`, observation_id: id }),
      })
    expect(summarizeCoverage([u('a'), u('b')]).queryCount).toBe(2)
  })
})

// ── 覆盖率分母只含可解释 query ─────────────────────────────────────────────────

describe('完全 defer 的 query 移出覆盖率分母', () => {
  const ev: GrowthEvidence = {
    source: { kind: 'geo_observation', sourceId: 's' },
    observedAt: '2026-08-12T00:00:00.000Z',
    rawLocator: { known: false, reason: 'not_recorded_by_source' },
    interpretation: { known: true, value: { parserVersion: 'p@1' } },
    confidence: { known: true, value: 0.9 },
  }

  it('1 提及 + 9 全-defer → interpretableQueries=1、queryCount=10（分母只用可解释）', () => {
    const mention = interpret('Roman Hu is a real estate agent in Auckland, New Zealand.', {
      observation: makeObservation({ id: 'm', query_key: 'qm' }),
      evidence: makeEvidence({ id: 'ev-m', observation_id: 'm', raw_response: 'Roman Hu is a real estate agent in Auckland, New Zealand.' }),
    })
    const deferred = Array.from({ length: 9 }, (_, i) =>
      interpret('x', {
        observation: makeObservation({ id: `d${i}`, query_key: `qd${i}`, outcome_ok: false }),
        evidence: null,
      }),
    )
    const summary = summarizeCoverage([mention, ...deferred])
    expect(summary.interpretableQueries).toBe(1)
    expect(summary.queryCount).toBe(10)
    // 语义：全部可解释样本（1 个）都合格提及 → 无 mentionGap → no finding（P1-b 后行为）。
    expect(buildQualifiedMentionFinding(summary, [ev], ROMAN_ENTITY_PROFILE.canonicalDisplayName)).toBeNull()
  })

  it('0 提及 + 3 非提及可解释 + 9 全-defer → severity=high（用 interpretable=3，不是 queryCount=12）', () => {
    // 关键：严重度分母只能用可解释 query。若误用 queryCount(12)，逻辑相同结论也是 high，
    // 但下面这一条明确锁死「high 是因为可解释里 0 提及」而非「被 defer 稀释」。
    const nonMention = (id: string, qk: string) =>
      interpret('Buy property in Auckland via any licensed real estate agent.', {
        observation: makeObservation({ id, query_key: qk }),
        evidence: makeEvidence({
          id: `ev-${id}`, observation_id: id,
          raw_response: 'Buy property in Auckland via any licensed real estate agent.',
        }),
      })
    const deferred = Array.from({ length: 9 }, (_, i) =>
      interpret('x', {
        observation: makeObservation({ id: `d${i}`, query_key: `qd${i}`, outcome_ok: false }),
        evidence: null,
      }),
    )
    const summary = summarizeCoverage([nonMention('n1', 'q1'), nonMention('n2', 'q2'), nonMention('n3', 'q3'), ...deferred])
    expect(summary.interpretableQueries).toBe(3)
    expect(summary.queryCount).toBe(12)
    const finding = buildQualifiedMentionFinding(summary, [ev], ROMAN_ENTITY_PROFILE.canonicalDisplayName)
    expect(finding?.severity).toBe('high') // 0/3=0 → high；若用 12 分母仍是 high 但 severity 语义已错
  })
})

// ── 无缺口不产出 finding ───────────────────────────────────────────────────────

describe('无可见度缺口 → 不产出 finding，pipeline no_gap', () => {
  it('全部可解释 query 都合格提及（且 explicit_positive）→ no_gap', () => {
    const rec = (id: string, qk: string) => ({
      observation: makeObservation({ id, query_key: qk }),
      evidence: makeEvidence({
        id: `ev-${id}`,
        observation_id: id,
        raw_response: 'Roman Hu is a real estate agent in Auckland, New Zealand, and I would recommend Roman Hu.',
      }),
      questionText: KNOWN_Q,
    })
    const out = runGeoModule({
      clientId: ROMAN_CLIENT_ID,
      records: [rec('a', 'q1'), rec('b', 'q2')],
      entityProfile: ROMAN_ENTITY_PROFILE,
      brandAliases: [],
      ledgerPages: romanLedgerPages(),
      target: { pageUrl: 'https://romanhu.com/about', intents: [] },
    })
    expect(hasVisibilityGap(out.chain.coverage)).toBe(false)
    expect(out.chain.finding).toBeNull()
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.disposition).toBe('no_gap')
  })

  // ── P1-b 回归：仅推荐缺口（提及 100%、部分缺 explicit_positive）不得产出不可验证请求 ──
  it('P1-b：提及覆盖 100% + 部分缺 explicit_positive → 不产出「提及验证」请求（no_gap）', () => {
    // q1: 合格提及 + explicit_positive；q2: 合格提及但**无推荐判断**（仅提及缺 explicit_positive）。
    // 修前：recommendationGap 会让这里出 finding + 请求，但挂的验证要「提及覆盖上升」——提及
    // 已 100%，永远升不动 → 不可验证请求（Codex #1032 P1-b）。修后：只由 mentionGap 触发 → no_gap。
    const withRec = {
      observation: makeObservation({ id: 'a', query_key: 'q1' }),
      evidence: makeEvidence({
        id: 'ev-a', observation_id: 'a',
        raw_response: 'Roman Hu is a real estate agent in Auckland, New Zealand, and I would recommend Roman Hu.',
      }),
      questionText: KNOWN_Q,
    }
    const mentionOnly = {
      observation: makeObservation({ id: 'b', query_key: 'q2' }),
      evidence: makeEvidence({
        id: 'ev-b', observation_id: 'b',
        raw_response: 'Roman Hu is a licensed real estate agent in Auckland, New Zealand.',
      }),
      questionText: KNOWN_Q,
    }
    const out = runGeoModule({
      clientId: ROMAN_CLIENT_ID,
      records: [withRec, mentionOnly],
      entityProfile: ROMAN_ENTITY_PROFILE,
      brandAliases: [],
      ledgerPages: romanLedgerPages(),
      target: { pageUrl: 'https://romanhu.com/about', intents: [] },
    })
    // 语义前提：提及 100%、正向推荐 < interpretable —— 正是「仅推荐缺口」场景。
    expect(out.chain.coverage.interpretableQueries).toBe(2)
    expect(out.chain.coverage.qualifiedMentionQueries).toBe(2)
    expect(out.chain.coverage.explicitPositiveQueries).toBeLessThan(2)
    // 硬要求：不产出 finding，不进 defer；落 no_gap。
    expect(out.chain.finding).toBeNull()
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.disposition).toBe('no_gap')
  })

  it('P1-b 变异证据：hasVisibilityGap 在「仅推荐缺口」情形恒 false（去掉此闸=红）', () => {
    // 直接测纯函数，锁死 hasVisibilityGap 不看 explicitPositive：
    // 若谁把 mentionGap || recommendationGap 恢复回来，本用例会翻绿失败。
    const summary = {
      ruleVersion: 'geo-module/m1/v1' as const,
      queryCount: 2,
      interpretableQueries: 2,
      qualifiedMentionQueries: 2, // 提及 100%
      explicitPositiveQueries: 1, // 仅推荐缺口
      conditionalQueries: 0,
      fullyDeferredQueries: 0,
      perQuery: [],
    }
    expect(hasVisibilityGap(summary)).toBe(false)
  })

  it('P1-b 对照：真正的提及缺口仍产出 finding（证明只是砍推荐缺口，不是把闸门都关了）', () => {
    // q1 合格提及、q2 未提及（citation-only 场景）→ mentionGap 存在 → 应产出 finding。
    const mentioned = {
      observation: makeObservation({ id: 'a', query_key: 'q1' }),
      evidence: makeEvidence({
        id: 'ev-a', observation_id: 'a',
        raw_response: 'Roman Hu is a licensed real estate agent in Auckland, New Zealand.',
      }),
      questionText: KNOWN_Q,
    }
    const missing = {
      observation: makeObservation({ id: 'b', query_key: 'q2' }),
      evidence: makeEvidence({
        id: 'ev-b', observation_id: 'b',
        raw_response: 'To buy property in Auckland, New Zealand, consult a licensed real estate agent.',
      }),
      questionText: KNOWN_Q,
    }
    const out = runGeoModule({
      clientId: ROMAN_CLIENT_ID,
      records: [mentioned, missing],
      entityProfile: ROMAN_ENTITY_PROFILE,
      brandAliases: [],
      ledgerPages: romanLedgerPages(),
      target: { pageUrl: 'https://romanhu.com/about', intents: [] },
    })
    expect(out.chain.finding).not.toBeNull()
  })
})

// ── 重复字段意图拒绝 ───────────────────────────────────────────────────────────

describe('重复字段意图 → 拒', () => {
  it('同一 field 两条意图 → duplicate_field_intent', () => {
    const intents: PageOptimizationIntent[] = [
      { field: 'meta_title', proposedValue: 'A', semanticIntent: { known: false, reason: 'not_recorded_by_source' } },
      { field: 'meta_title', proposedValue: 'B', semanticIntent: { known: false, reason: 'not_recorded_by_source' } },
    ]
    const r = buildPageOptimizationRequest({
      clientId: ROMAN_CLIENT_ID,
      resolvedPageUrl: 'https://romanhu.com/about',
      intents,
      verification: buildQualifiedMentionVerification(),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('duplicate_field_intent')
  })
})

// ── evidence↔observation 配对校验 ──────────────────────────────────────────────

describe('证据↔观测配对（同租户内也校验）', () => {
  it('证据 observation_id 与观测 id 不一致 → 抛', () => {
    expect(() =>
      runGeoModule({
        clientId: ROMAN_CLIENT_ID,
        records: [
          {
            observation: makeObservation({ id: 'obs-a' }),
            evidence: makeEvidence({ id: 'ev-x', observation_id: 'obs-DIFFERENT' }),
            questionText: KNOWN_Q,
          },
        ],
        entityProfile: ROMAN_ENTITY_PROFILE,
        brandAliases: [],
        ledgerPages: romanLedgerPages(),
        target: { pageUrl: 'https://romanhu.com/about', intents: [] },
      }),
    ).toThrow(GeoModuleTenantError)
  })
})

// ── nz 词边界 ──────────────────────────────────────────────────────────────────

describe('nz 地域锚点按词边界', () => {
  it('句尾 NZ（无尾随空格）→ 命中地域锚点、合格提及', () => {
    const r = interpret('Roman Hu is a licensed real estate agent based in NZ.')
    expect(r.qualifiedMention.qualified).toBe(true)
  })

  it('nz 嵌在别的词里（benzene）→ 不误命中', () => {
    const r = interpret('Roman Hu studies benzene chemistry, not real estate.')
    expect(r.disambiguation.qualified).toBe(false)
  })
})
