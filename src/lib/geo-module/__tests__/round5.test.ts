/**
 * WP05 第 5 轮修复的回归 + 变异证据（Codex #1032 复审 · PO 授权 P1 + A）。
 *
 * 每条修都带正向锁 + 「破坏修复即翻绿」的变异对照。
 */

import { describe, it, expect } from 'vitest'
import { interpretObservation, extractAnswerBody, KNOWN_ENVELOPE_VERSIONS } from '../m1'
import { makeObservation, makeEvidence, makeEvidenceRaw, makeRawEnvelope, ownedCitation, ROMAN_ENTITY_PROFILE } from './fixtures'

const KNOWN_Q = { known: true, value: 'who should i hire to sell my house?' } as const

function interp(rawResponse: string) {
  return interpretObservation({
    observation: makeObservation(),
    evidence: makeEvidence({ raw_response: rawResponse }),
    entityProfile: ROMAN_ENTITY_PROFILE,
    brandAliases: [],
    questionText: KNOWN_Q,
  })
}

/** 负向用例专用：raw_response 原样送入，不做 envelope 自动包装。 */
function interpRawUnwrapped(rawResponse: string | null, extra: Partial<Parameters<typeof makeEvidenceRaw>[1]> = {}) {
  return interpretObservation({
    observation: makeObservation(),
    evidence: makeEvidenceRaw(rawResponse, extra),
    entityProfile: ROMAN_ENTITY_PROFILE,
    brandAliases: [],
    questionText: KNOWN_Q,
  })
}

// ── P1 · envelope 解包 ────────────────────────────────────────────────────────

describe('P1 · raw_response 是 geo-baseline/openai/v1 信封，只扫 envelope.text', () => {
  it('已知版本 + text 非空 → ok', () => {
    const raw = makeRawEnvelope('Roman Hu is a licensed real estate agent in Auckland, New Zealand.')
    const r = extractAnswerBody(raw)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.text).toContain('Roman Hu')
  })

  it('citation 元数据里出现 "Roman Hu"，但 envelope.text 是无关正文 → 不判 body_match', () => {
    // 生产实证形态：answer 正文里没提 Roman，但 rawPayload 里的 web-search citation title
    // 含 "Roman Hu | Ray White Mission Bay - Auckland" —— 这是把 citation 错扫进 body 的入口。
    const raw = makeRawEnvelope(
      'To buy property in Auckland, consult a licensed real estate agent.',
      {
        citationUrls: ['https://romanhu.com/about'],
        rawPayload: {
          annotations: [
            {
              type: 'url_citation',
              url_citation: {
                url: 'https://romanhu.com/about',
                title: 'Roman Hu | Ray White Mission Bay - Auckland',
              },
            },
          ],
        },
      },
    )
    // 观测行的 `citations` 字段是解析后的结构化引用（GeoCitation[]），供 matchEntity 判 citation_only。
    // 生产解析器会把 annotations 转成这个数组；此处用 ownedCitation() 模拟。
    const r = interpretObservation({
      observation: makeObservation(),
      evidence: makeEvidence({ raw_response: raw, citations: [ownedCitation()] as never }),
      entityProfile: ROMAN_ENTITY_PROFILE,
      brandAliases: [],
      questionText: KNOWN_Q,
    })
    // 关键断言：即使 rawPayload/citationUrls 里满是 "Roman Hu"、"Auckland"、"Ray White"，
    // envelope.text 里没有 → 只能落 citation_only（M1 §2），绝不 body_match。
    expect(r.entityMatch.kind).not.toBe('body_match')
    expect(r.qualifiedMention.qualified).toBe(false)
    expect(r.entityMatch.kind).toBe('citation_only')
  })

  it('信封 JSON 损坏 → defer raw_response_envelope_unreadable', () => {
    const r = interpRawUnwrapped('{ not valid json')
    expect(r.disposition).toBe('defer')
    expect(r.reasonCodes).toContain('raw_response_envelope_unreadable')
  })

  it('未知 envelope 版本 → defer（不宽松解析未来版本）', () => {
    const raw = JSON.stringify({ envelope: 'geo-baseline/openai/v99', text: 'x' })
    const r = interpRawUnwrapped(raw)
    expect(r.disposition).toBe('defer')
    expect(r.reasonCodes).toContain('raw_response_envelope_unreadable')
  })

  it('envelope.text 为 null → defer（拒答/空正文当 defer）', () => {
    const raw = JSON.stringify({ envelope: 'geo-baseline/openai/v1', text: null })
    const r = interpRawUnwrapped(raw)
    expect(r.disposition).toBe('defer')
    expect(r.reasonCodes).toContain('raw_response_envelope_unreadable')
  })

  it('envelope.text 为空串 → defer', () => {
    const raw = JSON.stringify({ envelope: 'geo-baseline/openai/v1', text: '' })
    const r = interpRawUnwrapped(raw)
    expect(r.disposition).toBe('defer')
    expect(r.reasonCodes).toContain('raw_response_envelope_unreadable')
  })

  it('缺 envelope 字段 → defer（不当成裸 JSON 扫）', () => {
    const raw = JSON.stringify({ text: 'Roman Hu is a real estate agent in Auckland, New Zealand.' })
    const r = interpRawUnwrapped(raw)
    expect(r.disposition).toBe('defer')
    expect(r.reasonCodes).toContain('raw_response_envelope_unreadable')
  })

  it('版本白名单只含 v1（未来加版本必须显式登记）', () => {
    expect(KNOWN_ENVELOPE_VERSIONS).toEqual(['geo-baseline/openai/v1'])
  })

  it('P1 变异证据：若把 envelope 解包去掉、直接扫整段 JSON → 上面「citation 元数据不入 body」用例翻红', () => {
    // 这条不是执行变异，是**语义锁**：直接测 extractAnswerBody 的必要性。
    // 若谁把 interpretObservation 里的 extractAnswerBody 换回 `normalizeText(raw_response)`：
    // 信封 JSON 里的 "Roman Hu"、"Auckland"、"real estate" 会全部命中 body 判据，
    // qualifiedMention 变 true，「citation 元数据不入 body」的用例立刻翻绿失败。
    // 这条 spec 用一条简单不变量把「必须走 extractAnswerBody」这件事钉死。
    const raw = JSON.stringify({
      envelope: 'geo-baseline/openai/v1',
      text: 'x', // 极短、不含实体
      rawPayload: {
        annotations: [{ title: 'Roman Hu | Ray White | Auckland real estate' }],
      },
    })
    const r = extractAnswerBody(raw)
    expect(r.ok).toBe(true)
    if (r.ok) {
      // 硬要求：返回的 text 就是 envelope.text，不含 rawPayload 内容。
      expect(r.text).toBe('x')
      expect(r.text).not.toContain('Roman Hu')
    }
  })
})

// ── A · hasUnnegated 词边界（recommendations 不再假阳 explicit_positive）─────

describe('A · 推荐词按词边界匹配，`recommendations`（复数客户评价）不算推荐', () => {
  it('“customer recommendations” 出现 → 不算 explicit_positive', () => {
    const r = interp(
      makeRawEnvelope(
        'Roman Hu is a real estate agent in Auckland, New Zealand, with many customer recommendations from past clients.',
      ),
    )
    // 合格提及仍成立（地产 + 奥克兰 + Roman 同句），但推荐词是名词复数，不是选择判断
    expect(r.qualifiedMention.qualified).toBe(true)
    expect(r.recommendation).not.toBe('explicit_positive')
  })

  it('对照：真正的 “I recommend Roman Hu” → explicit_positive（证明不是把整个闸关了）', () => {
    const r = interp(
      makeRawEnvelope(
        'Roman Hu is a real estate agent in Auckland, New Zealand, and I recommend Roman Hu.',
      ),
    )
    expect(r.recommendation).toBe('explicit_positive')
  })

  it('recommended（过去分词，与 Roman 同句）仍命中 explicit_positive', () => {
    // 🔴 跨句代词指代（"Roman Hu is great. He is recommended."）是文档明示的保守欠报 ——
    //    句子级绑定不追指代。同句形态才应命中，正是要锁的正向能力。
    const r = interp(
      makeRawEnvelope(
        'Roman Hu is a real estate agent in Auckland, New Zealand, and is highly recommended.',
      ),
    )
    expect(r.recommendation).toBe('explicit_positive')
  })

  it('A 变异证据：若 hasUnnegated 退回裸 indexOf（无词边界），customer recommendations 会翻绿', () => {
    // 语义锁：直接用一条对 hasUnnegated 契约敏感的输入 —— 这个句子里 recommend 只以
    // recommendations 出现一次，无独立的 recommend/recommends/recommended 词。
    // 若词边界丢失，`.includes('recommend')` 会命中 recommendations → 判 explicit_positive。
    const r = interp(
      makeRawEnvelope(
        'Roman Hu is a real estate agent in Auckland, New Zealand — 300+ recommendations on file.',
      ),
    )
    expect(r.recommendation).not.toBe('explicit_positive')
  })
})
