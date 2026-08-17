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
import { makeObservation, makeEvidence, romanLedgerPages, ROMAN_CLIENT_ID } from './fixtures'

const KNOWN_Q = { known: true, value: 'who should i hire to sell my house?' } as const

function interpret(rawResponse: string, over: Partial<Parameters<typeof interpretObservation>[0]> = {}) {
  return interpretObservation({
    observation: makeObservation(),
    evidence: makeEvidence({ raw_response: rawResponse }),
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

  it('1 提及 + 9 全-defer → severity=low（分母=1），不是被稀释成 medium', () => {
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
    const finding = buildQualifiedMentionFinding(summary, [ev])
    // 分母=可解释(1) → 1/1 → low。若误用 queryCount(10) → 0.1 → medium（变异对照）。
    expect(finding?.severity).toBe('low')
  })
})

// ── 无缺口不产出 finding ───────────────────────────────────────────────────────

describe('无可见度缺口 → 不产出 finding，pipeline no_gap', () => {
  it('全部可解释 query 都 explicit_positive → hasVisibilityGap=false、finding=null、no_gap', () => {
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
      brandAliases: [],
      ledgerPages: romanLedgerPages(),
      target: { pageUrl: 'https://romanhu.com/about', intents: [] },
    })
    expect(hasVisibilityGap(out.chain.coverage)).toBe(false)
    expect(out.chain.finding).toBeNull()
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.disposition).toBe('no_gap')
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
