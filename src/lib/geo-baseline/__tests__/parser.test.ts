/**
 * parser 判据（Issue #883 / #917 · WP04A）。
 *
 * 重点盯两条容易被写错成「更好看」的地方：
 *   · 域名未核实 ⇒ 未知，**不是 false**
 *   · 页面台账缺失 ⇒ 不可算，**绝不是 0 / false / 省略字段**
 */

import { describe, expect, it } from 'vitest'
import { classifyOwnedDomain, createGeoBaselineParser, normaliseHost, parseEnvelope } from '../parser'
import type { GeoBaselineParserConfig, GeoRawResponseEnvelope } from '../types'
import type { GeoProviderRequest } from '@/lib/geo-measurement-runtime'
import { validateGeoEvidence } from '@/lib/geo-measurement'

const REQUEST: GeoProviderRequest = {
  queryKey: 'q1',
  questionText: 'q',
  engineFamily: 'openai',
  modelVersion: 'm',
  locale: 'en-NZ',
  market: 'nz',
  sampleIndex: 0,
  samplingParameters: { known: false, reason: 'not_recorded_by_source' },
}

const PAGE_POLICY = { computable: false as const, reason: '页面台账为空，本轮未裁定页面级归属' }

function envelope(citationUrls: string[], text = 'answer'): string {
  const e: GeoRawResponseEnvelope = {
    envelope: 'geo-baseline/openai/v1',
    resolvedModel: 'm',
    text,
    citationUrls,
    usage: { promptTokens: 1, completionTokens: 1 },
  }
  return JSON.stringify(e)
}

function config(overrides: Partial<GeoBaselineParserConfig> = {}): GeoBaselineParserConfig {
  return {
    ownedDomains: { verifiedDomains: [], verified: false },
    ownedPages: PAGE_POLICY,
    ...overrides,
  }
}

describe('自有域名归属（R10 / GEO 契约 M8）', () => {
  it('清单未核实 ⇒ ownedDomain 记未知，绝不是 false', () => {
    const parse = createGeoBaselineParser(config())
    const result = parse(envelope(['https://romanhu.com/x']), REQUEST)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.citations[0].ownedDomain).toEqual({ known: false, reason: 'not_recorded_by_source' })
  })

  it('已核实且命中 ⇒ true', () => {
    const parse = createGeoBaselineParser(
      config({ ownedDomains: { verifiedDomains: ['romanhu.com'], verified: true } }),
    )
    const result = parse(envelope(['https://www.romanhu.com/about']), REQUEST)
    if (!result.ok) throw new Error('should parse')
    expect(result.citations[0].ownedDomain).toEqual({ known: true, value: true })
  })

  it('已核实但没命中 ⇒ false（这时 false 才是一个真结论）', () => {
    const parse = createGeoBaselineParser(
      config({ ownedDomains: { verifiedDomains: ['romanhu.com'], verified: true } }),
    )
    const result = parse(envelope(['https://realestate.co.nz/listing/1']), REQUEST)
    if (!result.ok) throw new Error('should parse')
    expect(result.citations[0].ownedDomain).toEqual({ known: true, value: false })
  })

  it('子域算自有；同后缀但不同域的不算（rromanhu.com ≠ romanhu.com）', () => {
    expect(classifyOwnedDomain('blog.romanhu.com', { verifiedDomains: ['romanhu.com'], verified: true })).toEqual({
      known: true,
      value: true,
    })
    expect(classifyOwnedDomain('notromanhu.com', { verifiedDomains: ['romanhu.com'], verified: true })).toEqual({
      known: true,
      value: false,
    })
  })

  it('normaliseHost 只去一个前导 www.，不做别的猜测', () => {
    expect(normaliseHost('WWW.Romanhu.COM')).toBe('romanhu.com')
    expect(normaliseHost('www.www.x.com')).toBe('www.x.com')
  })
})

describe('页面级归属（R4 / WP00 §14 第 14 条）', () => {
  it('恒为 not_computable 且带理由 —— 绝不是 0 / false / 省略', () => {
    const parse = createGeoBaselineParser(config())
    const result = parse(envelope(['https://a.com/1', 'https://b.com/2']), REQUEST)
    if (!result.ok) throw new Error('should parse')
    for (const c of result.citations) {
      expect(c.ownedPage.status).toBe('not_computable')
      expect(c.ownedPage.status === 'not_computable' && c.ownedPage.reason.length).toBeGreaterThan(0)
    }
  })
})

describe('信封读取', () => {
  it('不是 JSON ⇒ 失败观测，不是「空引用的成功观测」', () => {
    const parse = createGeoBaselineParser(config())
    expect(parse('not json', REQUEST)).toMatchObject({ ok: false, errorCode: 'envelope_not_json' })
  })

  it('信封版本对不上 ⇒ 失败（老行由老版本解析器读，不许被新版本猜着读）', () => {
    const parse = createGeoBaselineParser(config())
    const bad = JSON.stringify({ envelope: 'geo-baseline/openai/v0', text: '', citationUrls: [] })
    expect(parse(bad, REQUEST)).toMatchObject({ ok: false, errorCode: 'envelope_version_unsupported' })
  })

  it('缺 text 或 citationUrls ⇒ 失败', () => {
    expect(parseEnvelope(JSON.stringify({ envelope: 'geo-baseline/openai/v1', text: 'x' }))).toMatchObject({
      ok: false,
      errorCode: 'envelope_malformed',
    })
  })
})

describe('confidence = 读取保真度（v1 语义）', () => {
  it('全部引用都读得出主机名 ⇒ 1', () => {
    const parse = createGeoBaselineParser(config())
    const result = parse(envelope(['https://a.com/1', 'https://b.com/2']), REQUEST)
    if (!result.ok) throw new Error('should parse')
    expect(result.confidence).toBe(1)
  })

  it('一条引用都没有 ⇒ 1（「一个来源都没引」是结论，不是读取失败）', () => {
    const parse = createGeoBaselineParser(config())
    const result = parse(envelope([]), REQUEST)
    if (!result.ok) throw new Error('should parse')
    expect(result.confidence).toBe(1)
    expect(result.citations).toEqual([])
  })

  it('一半 URL 解析不出来 ⇒ 0.5，且坏的那条不进 citations', () => {
    const parse = createGeoBaselineParser(config())
    const result = parse(envelope(['https://a.com/1', 'not-a-url']), REQUEST)
    if (!result.ok) throw new Error('should parse')
    expect(result.confidence).toBe(0.5)
    expect(result.citations).toHaveLength(1)
  })

  it('confidence 落在 [0,1] —— WP02 校验器只接受这个区间', () => {
    const parse = createGeoBaselineParser(config())
    const result = parse(envelope(['x', 'y', 'z']), REQUEST)
    if (!result.ok) throw new Error('should parse')
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
  })
})

describe('产出的 citation 必须过 WP02 校验器', () => {
  it('未核实域名 + 不可算页面的组合是合法的 GeoEvidence', () => {
    const parse = createGeoBaselineParser(config())
    const result = parse(envelope(['https://romanhu.com/a']), REQUEST)
    if (!result.ok) throw new Error('should parse')
    const verdict = validateGeoEvidence({
      evidenceId: 'e1',
      observationId: 'o1',
      rawResponseLocator: { known: true, value: 'db://public.geo_evidence/e1/raw_response' },
      citations: result.citations,
    })
    expect(verdict.ok, verdict.ok ? '' : verdict.reason).toBe(true)
  })
})
