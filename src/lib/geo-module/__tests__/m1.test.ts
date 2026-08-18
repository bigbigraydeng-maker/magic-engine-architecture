/**
 * `geo-module/m1/v1` 观测级解释器 —— 每条判据一个用例（Issue #879 / WP05）。
 *
 * 每条断言指向 #879 冻结评论里的一条，不是凑数。
 */

import { describe, it, expect } from 'vitest'
import { interpretObservation, DEFAULT_CONFIDENCE_THRESHOLD } from '../m1'
import { GEO_M1_RULE_VERSION } from '../types'
import { makeObservation, makeEvidence, ownedCitation, ROMAN_ENTITY_PROFILE } from './fixtures'

const NO_QUESTION = { known: false, reason: 'not_recorded_by_source' } as const
const NO_ALIASES: readonly string[] = []
/**
 * 默认已知问句，且**不与任何测试正文逐字重合**（避免误触回显剔除），也**不点名 Roman**
 * （branded=false）。问句未知会触发新的「question_text_unknown → defer」闸，所以判定类用例
 * 必须给一个已知问句。
 */
const KNOWN_QUESTION = { known: true, value: 'who should i contact to buy or sell a home?' } as const

function interpret(rawResponse: string, opts: {
  citations?: unknown[]
  confidence?: number | null
  questionText?: { known: true; value: string } | { known: false; reason: 'not_recorded_by_source' }
} = {}) {
  const observation = makeObservation({
    confidence: opts.confidence === undefined ? 0.9 : opts.confidence,
    confidence_unknown_reason: opts.confidence === null ? 'not_recorded_by_source' : null,
  })
  const evidence = makeEvidence({ raw_response: rawResponse, citations: (opts.citations ?? []) as never })
  return interpretObservation({
    observation,
    evidence,
    entityProfile: ROMAN_ENTITY_PROFILE,
    brandAliases: NO_ALIASES,
    questionText: opts.questionText ?? KNOWN_QUESTION,
  })
}

describe('§1 实体匹配：精确、无模糊、无别名推断', () => {
  it('答案正文精确命中 Roman Hu（含所有格）→ body_match', () => {
    const r = interpret("Roman Hu is a real estate agent in Auckland, New Zealand. Roman Hu's clients love him.")
    expect(r.entityMatch.kind).toBe('body_match')
  })

  it('模糊变体 Romann Hu / Roman Huang 一律不匹配（§1 禁止模糊）', () => {
    const r = interpret('Romann Hu and Roman Huang are agents in Auckland, New Zealand real estate.')
    expect(r.entityMatch.kind).toBe('no_match')
  })

  it('姓氏单称 Hu 不匹配（§1 禁止姓氏单独）', () => {
    const r = interpret('Hu is a real estate agent based in Auckland, New Zealand.')
    expect(r.entityMatch.kind).toBe('no_match')
  })

  it('别名注册表为空这件事永远留痕', () => {
    const r = interpret('Anything.')
    expect(r.reasonCodes).toContain('brand_alias_registry_empty')
    expect(r.ruleVersion).toBe(GEO_M1_RULE_VERSION)
  })
})

describe('§2 消歧 + §3 合格提及', () => {
  it('正文命中 + 奥克兰/NZ地产锚点 → 合格提及', () => {
    const r = interpret('Roman Hu is a licensed real estate agent in Auckland, New Zealand.')
    expect(r.qualifiedMention.qualified).toBe(true)
    expect(r.disambiguation.qualified).toBe(true)
  })

  it('正文命中但无地产/地域锚点 → 消歧不足，不合格', () => {
    const r = interpret('Roman Hu is an author who writes historical novels.')
    expect(r.disambiguation.qualified).toBe(false)
    expect(r.qualifiedMention.qualified).toBe(false)
    expect(r.reasonCodes).toContain('disambiguation_insufficient')
  })

  it('名字只在 owned 引用里出现、正文没有 → citation_only，不合格（owned citation ≠ mention）', () => {
    const r = interpret('To buy property in Auckland, New Zealand, consult a licensed real estate agent.', {
      citations: [ownedCitation()],
    })
    expect(r.entityMatch.kind).toBe('citation_only')
    expect(r.qualifiedMention.qualified).toBe(false)
    expect(r.reasonCodes).toContain('name_only_in_citation')
  })

  it('正文里的命中只是问句回显 → query_echo_only，不合格', () => {
    const r = interpret(
      'Is Roman Hu good? For real estate in Auckland, New Zealand, compare several licensed agents before deciding.',
      { questionText: { known: true, value: 'Is Roman Hu good?' } },
    )
    expect(r.entityMatch.kind).toBe('body_match')
    expect(r.qualifiedMention.qualified).toBe(false)
    expect(r.reasonCodes).toContain('query_echo_only')
  })
})

describe('§4 推荐分级（只有 explicit_positive 进指标）', () => {
  it('明确推荐 → explicit_positive', () => {
    const r = interpret('Roman Hu is a real estate agent in Auckland, New Zealand. I would recommend Roman Hu.')
    expect(r.recommendation).toBe('explicit_positive')
  })

  it('带条件的推荐 → conditional', () => {
    const r = interpret(
      'Roman Hu is a real estate agent in Auckland, New Zealand. If you are selling a premium home, I would recommend Roman Hu.',
    )
    expect(r.recommendation).toBe('conditional')
  })

  it('明确不推荐 → negative', () => {
    const r = interpret(
      'Roman Hu is a real estate agent in Auckland, New Zealand, but I would not suggest Roman Hu for first-home buyers.',
    )
    expect(r.recommendation).toBe('negative')
  })

  it('提及但无判断 → none', () => {
    const r = interpret('Roman Hu is a real estate agent in Auckland, New Zealand.')
    expect(r.recommendation).toBe('none')
    expect(r.reasonCodes).toContain('no_recommendation_judgment')
  })

  it('无合格提及 → 推荐 none（不落别的）', () => {
    const r = interpret('Buy real estate in Auckland via any licensed realtor.')
    expect(r.recommendation).toBe('none')
  })

  // ── 否定处理（魏征复审：裸子串匹配会把被否定的背书判成 explicit_positive）──
  it('被否定的背书（wouldn\'t go with）→ negative，不进正向指标', () => {
    const r = interpret(
      "Roman Hu is a real estate agent in Auckland, New Zealand, but I wouldn't go with Roman Hu.",
    )
    expect(r.recommendation).toBe('negative')
  })

  it('do not recommend（recommend 是子串）→ negative，不是 indeterminate', () => {
    const r = interpret(
      'Roman Hu is a real estate agent in Auckland, New Zealand. I do not recommend Roman Hu.',
    )
    expect(r.recommendation).toBe('negative')
  })
})

describe('§5 rank：只认显式精确序数', () => {
  it('显式 first choice → computed position 1', () => {
    const r = interpret(
      'Roman Hu is a real estate agent in Auckland, New Zealand, and is the first choice for luxury homes.',
    )
    expect(r.rank).toEqual({ status: 'computed', position: 1 })
  })

  it('冲突序数（同一句内）→ not_computable（ordinal_ambiguous）', () => {
    // 🔴 冲突序数必须在 Roman **同一句**内才算冲突；跨句 / 跨破折号的序数已被句子级绑定切离。
    const r = interpret(
      'Roman Hu, a real estate agent in Auckland, New Zealand, is ranked first choice by some and second choice by others.',
    )
    expect(r.rank.status).toBe('not_computable')
    expect(r.reasonCodes).toContain('ordinal_ambiguous')
  })

  it('无合格提及 → rank not_applicable', () => {
    const r = interpret('Buy property in Auckland via any licensed agent.')
    expect(r.rank).toEqual({ status: 'not_applicable' })
  })

  it('合格提及但无序数 → not_computable（no_explicit_ordinal）', () => {
    const r = interpret('Roman Hu is a real estate agent in Auckland, New Zealand.')
    expect(r.rank).toEqual({ status: 'not_computable', reason: 'no_explicit_ordinal' })
  })

  it('被否定的序数（not the first choice）→ 不判 computed', () => {
    const r = interpret(
      'Roman Hu is a real estate agent in Auckland, New Zealand, but he is not the first choice here.',
    )
    expect(r.rank.status).not.toBe('computed')
  })
})

describe('§2 消歧锚点收紧：通用 agent 不误锁本人', () => {
  it('travel agent（非地产）→ 消歧不足，不合格提及', () => {
    const r = interpret('Roman Hu is a travel agent based in Auckland, New Zealand.')
    expect(r.disambiguation.qualified).toBe(false)
    expect(r.qualifiedMention.qualified).toBe(false)
  })

  it('licensed real estate agent（地产强锚）→ 合格提及', () => {
    const r = interpret('Roman Hu is a licensed real estate agent in Auckland, New Zealand.')
    expect(r.qualifiedMention.qualified).toBe(true)
  })
})

describe('§6 证据不足 → defer，绝不静默转 false/0', () => {
  it('观测失败（无证据行）→ defer evidence_missing', () => {
    const observation = makeObservation({ outcome_ok: false, error_code: 'timeout', error_message: 'x', error_message_unknown_reason: null })
    const r = interpretObservation({ observation, evidence: null, entityProfile: ROMAN_ENTITY_PROFILE, brandAliases: NO_ALIASES, questionText: NO_QUESTION })
    expect(r.disposition).toBe('defer')
    expect(r.reasonCodes).toContain('evidence_missing')
    // 🔴 defer 不是 false：mention 是「未判定」，不是「判为没有」。
    expect(r.qualifiedMention.qualified).toBe(false)
    expect(r.recommendation).toBe('none')
  })

  it('原始响应读不出 → defer raw_response_unreadable', () => {
    const observation = makeObservation()
    const evidence = makeEvidence({ raw_response: null, raw_response_unknown_reason: 'not_recorded_by_source', raw_response_locator: null })
    const r = interpretObservation({ observation, evidence, entityProfile: ROMAN_ENTITY_PROFILE, brandAliases: NO_ALIASES, questionText: NO_QUESTION })
    expect(r.disposition).toBe('defer')
    expect(r.reasonCodes).toContain('raw_response_unreadable')
  })

  it('置信度未知 → defer confidence_unknown', () => {
    const r = interpret('Roman Hu is a real estate agent in Auckland, New Zealand.', { confidence: null })
    expect(r.disposition).toBe('defer')
    expect(r.reasonCodes).toContain('confidence_unknown')
  })

  it('置信度低于阈值 → defer confidence_below_threshold', () => {
    const r = interpret('Roman Hu is a real estate agent in Auckland, New Zealand.', {
      confidence: DEFAULT_CONFIDENCE_THRESHOLD - 0.01,
    })
    expect(r.disposition).toBe('defer')
    expect(r.reasonCodes).toContain('confidence_below_threshold')
  })

  // ── P1-a 回归：阈值对齐冻结策略 GEO_COMPARABILITY_POLICY_V1.minParserConfidence（=0.80）──
  it('P1-a：阈值恒等于测量层冻结策略 minParserConfidence（0.80）', () => {
    expect(DEFAULT_CONFIDENCE_THRESHOLD).toBe(0.8)
  })

  it('P1-a：confidence=0.79 → defer（低于策略下限）', () => {
    const r = interpret('Roman Hu is a licensed real estate agent in Auckland, New Zealand.', {
      confidence: 0.79,
    })
    expect(r.disposition).toBe('defer')
    expect(r.reasonCodes).toContain('confidence_below_threshold')
  })

  it('P1-a：confidence=0.80 → 可解释（达到策略下限，不 defer）', () => {
    const r = interpret('Roman Hu is a licensed real estate agent in Auckland, New Zealand.', {
      confidence: 0.8,
    })
    expect(r.disposition).toBe('interpreted')
    expect(r.reasonCodes).not.toContain('confidence_below_threshold')
  })

  it('P1-a 变异证据：若阈值退回 0.5，0.79 会错判为可解释（本 spec 用来锁 0.8 语义）', () => {
    // 0.5 < 0.79 < 0.8：当前 0.8 阈值下 defer；若谁改回 0.5 阈值，同一输入会翻成 interpreted。
    // 这条 spec 就是那道翻绿信号 —— 与上一条对照，锁死「阈值必须 >= 0.79 + epsilon」。
    const r = interpret('Roman Hu is a licensed real estate agent in Auckland, New Zealand.', {
      confidence: 0.79,
    })
    expect(r.disposition).not.toBe('interpreted')
  })
})

describe('§6 结构化审计输出：血缘齐全', () => {
  it('保留 rule_version + observationId + 批次/证据/解析血缘', () => {
    const r = interpret('Roman Hu is a real estate agent in Auckland, New Zealand.')
    expect(r.ruleVersion).toBe(GEO_M1_RULE_VERSION)
    expect(r.observationId).toBe('obs-0001')
    expect(r.lineage.batchId).toBe('688bd8ae-2db6-4300-b761-b850f30c32c5')
    expect(r.lineage.parserVersion).toEqual({ known: true, value: 'geo-parser@2026-08-01' })
    expect(r.lineage.evidenceLocator.known).toBe(true)
  })
})
