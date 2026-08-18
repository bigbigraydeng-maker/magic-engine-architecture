/**
 * GEO Module v1 分段单测：证据映射 · 聚合护栏 · 台账解析（Issue #879 / WP05）。
 */

import { describe, it, expect } from 'vitest'
import { toGrowthEvidence } from '../evidence'
import { summarizeCoverage, buildQualifiedMentionFinding } from '../finding'
import { resolveLedgerPage } from '../page-request'
import { interpretObservation } from '../m1'
import { validateGrowthEvidence } from '@/lib/growth'
import { makeObservation, makeEvidence, romanLedgerPages, ROMAN_CLIENT_ID } from './fixtures'
import type { GeoObservationInterpretation } from '../types'

const NO_QUESTION = { known: false, reason: 'not_recorded_by_source' } as const

describe('证据映射：不知道就记理由，绝不补 0', () => {
  it('成功观测 → 合法 GrowthEvidence（locator/parser/confidence 全 known）', () => {
    const e = toGrowthEvidence({ observation: makeObservation(), evidence: makeEvidence() })
    expect(validateGrowthEvidence(e).ok).toBe(true)
    expect(e.confidence).toEqual({ known: true, value: 0.9 })
    expect(e.source).toEqual({ kind: 'geo_observation', sourceId: 'obs-0001' })
  })

  it('失败观测（无证据行）→ locator 诚实未知，仍是合法证据', () => {
    const e = toGrowthEvidence({
      observation: makeObservation({ outcome_ok: false }),
      evidence: null,
    })
    expect(validateGrowthEvidence(e).ok).toBe(true)
    expect(e.rawLocator).toEqual({ known: false, reason: 'not_recorded_by_source' })
  })

  it('confidence 为 null → 未知带理由，不是 0', () => {
    const e = toGrowthEvidence({
      observation: makeObservation({ confidence: null, confidence_unknown_reason: 'source_ambiguous' }),
      evidence: makeEvidence(),
    })
    expect(e.confidence).toEqual({ known: false, reason: 'source_ambiguous' })
  })
})

describe('聚合护栏（M1 §7）', () => {
  function interp(rawResponse: string, queryKey: string, id: string) {
    return interpretObservation({
      observation: makeObservation({ id, query_key: queryKey }),
      evidence: makeEvidence({ id: `ev-${id}`, observation_id: id, raw_response: rawResponse }),
      brandAliases: [],
      // 已知问句（不与正文重合、不点名 Roman）——否则 body_match + 问句未知会触发 defer。
      questionText: { known: true, value: 'who is a good agent to hire?' },
    })
  }

  it('一个 query 多条样本合格提及只计一次', () => {
    const body = 'Roman Hu is a real estate agent in Auckland, New Zealand.'
    const s = summarizeCoverage([interp(body, 'q1', 'a'), interp(body, 'q1', 'b')])
    expect(s.queryCount).toBe(1)
    expect(s.qualifiedMentionQueries).toBe(1)
  })

  it('query_key 未知的观测各自成组，不并池', () => {
    const it1 = interpretObservation({
      observation: makeObservation({ id: 'u1', query_key: null, query_key_unknown_reason: 'not_recorded_by_source' }),
      evidence: makeEvidence({ id: 'ev-u1', observation_id: 'u1' }),
      brandAliases: [], questionText: NO_QUESTION,
    })
    const it2 = interpretObservation({
      observation: makeObservation({ id: 'u2', query_key: null, query_key_unknown_reason: 'not_recorded_by_source' }),
      evidence: makeEvidence({ id: 'ev-u2', observation_id: 'u2' }),
      brandAliases: [], questionText: NO_QUESTION,
    })
    expect(summarizeCoverage([it1, it2]).queryCount).toBe(2)
  })

  it('聚合结构里根本没有 citation 覆盖字段（12/12 带引用不许重述成提及）', () => {
    const s = summarizeCoverage([interp('irrelevant', 'q1', 'a')])
    expect(Object.keys(s)).not.toContain('citationCoverage')
    expect(Object.keys(s)).not.toContain('citationQueries')
  })

  it('无证据 → 建不出 finding（返回 null，不硬造无证据发现）', () => {
    const s = summarizeCoverage([])
    expect(buildQualifiedMentionFinding(s, [])).toBeNull()
  })
})

describe('台账解析：只在本租户内、精确命中', () => {
  it('本租户存在的 URL → ok', () => {
    const r = resolveLedgerPage(romanLedgerPages(), ROMAN_CLIENT_ID, 'https://romanhu.com/about')
    expect(r).toEqual({ ok: true, url: 'https://romanhu.com/about' })
  })

  it('URL 不存在 → unattributable_page', () => {
    const r = resolveLedgerPage(romanLedgerPages(), ROMAN_CLIENT_ID, 'https://romanhu.com/missing')
    expect(r).toEqual({ ok: false, reason: 'unattributable_page' })
  })

  it('页属于别的租户 → 解析不到（哪怕 URL 相同）', () => {
    const r = resolveLedgerPage(
      [{ client_id: 'other', url: 'https://romanhu.com/about' }],
      ROMAN_CLIENT_ID,
      'https://romanhu.com/about',
    )
    expect(r).toEqual({ ok: false, reason: 'unattributable_page' })
  })
})

// 类型层锚点：确保聚合返回的 perQuery 携带 locale/branded（不混池的前提）。
const _typeAnchor: (i: GeoObservationInterpretation[]) => unknown = (i) => summarizeCoverage(i).perQuery
void _typeAnchor
