import { describe, it, expect } from 'vitest'
import { validatePageChange } from '../validate'
import type { PageDiffResult, PageOptimizationRequest, ProviderCheckInput, RedlineCheckInput } from '../types'

function baseRequest(doNotTouch: PageOptimizationRequest['constraints']['doNotTouch'] = []): PageOptimizationRequest {
  return {
    clientId: 'client-1',
    page: { url: 'https://romanhu.com/listings/123' },
    intents: [],
    lineage: { findingRefs: ['finding-1'] },
    verification: {
      metricRef: 'geo.owned_page_citation',
      windowDays: 14,
      baseline: 'previous_measurement',
      criteria: { success: 'citation increases', failure: 'citation unchanged or drops', indeterminate: 'not_comparable' },
    },
    constraints: { doNotTouch },
    basedOnVersion: { known: false, reason: 'not_recorded_by_source' },
  }
}

const OK_DIFF: PageDiffResult = {
  ok: true,
  changes: [{ field: 'meta_title', before: 'Old Title', after: 'New Title', changed: true }],
}

const AVAILABLE_NO_REDLINES: RedlineCheckInput = { available: true, phrases: [] }
const PASSED_PROVIDER_CHECK: ProviderCheckInput = { evaluated: true, passed: true, violations: [] }

describe('validatePageChange · doNotTouch', () => {
  it('改动命中 doNotTouch 字段 → 拒绝', () => {
    const result = validatePageChange(baseRequest(['meta_title']), OK_DIFF, AVAILABLE_NO_REDLINES, PASSED_PROVIDER_CHECK)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.violations.some((v) => v.includes('meta_title'))).toBe(true)
  })

  it('doNotTouch 里的字段没被真的改动（changed=false）→ 不算违规', () => {
    const unchangedDiff: PageDiffResult = {
      ok: true,
      changes: [{ field: 'meta_title', before: 'Same', after: 'Same', changed: false }],
    }
    const result = validatePageChange(baseRequest(['meta_title']), unchangedDiff, AVAILABLE_NO_REDLINES, PASSED_PROVIDER_CHECK)
    expect(result.ok).toBe(true)
  })
})

describe('validatePageChange · 红线短语命中', () => {
  it('改动后的值命中红线短语（大小写不敏感子串）→ 拒绝', () => {
    const redline: RedlineCheckInput = { available: true, phrases: ['since 1928'] }
    const diff: PageDiffResult = {
      ok: true,
      changes: [{ field: 'meta_title', before: 'Old', after: 'Auckland Since 1928', changed: true }],
    }
    const result = validatePageChange(baseRequest(), diff, redline, PASSED_PROVIDER_CHECK)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.violations.some((v) => v.includes('since 1928'))).toBe(true)
  })

  it('没命中任何红线短语 → 不因此被拒', () => {
    const redline: RedlineCheckInput = { available: true, phrases: ['forbidden phrase'] }
    const result = validatePageChange(baseRequest(), OK_DIFF, redline, PASSED_PROVIDER_CHECK)
    expect(result.ok).toBe(true)
  })
})

describe('validatePageChange · 红线状态缺失必须 fail closed', () => {
  it('红线查询失败 → 拒绝，不当成"没有红线"', () => {
    const redline: RedlineCheckInput = { available: false, reason: '红线查询失败' }
    const result = validatePageChange(baseRequest(), OK_DIFF, redline, PASSED_PROVIDER_CHECK)
    expect(result.ok).toBe(false)
  })
})

describe('validatePageChange · provider 校验未评估不能算通过', () => {
  it('provider 校验没跑过（evaluated:false）→ 拒绝，不能被表示成通过', () => {
    const providerCheck: ProviderCheckInput = { evaluated: false, reason: '还没来得及跑 provider 侧校验' }
    const result = validatePageChange(baseRequest(), OK_DIFF, AVAILABLE_NO_REDLINES, providerCheck)
    expect(result.ok).toBe(false)
  })

  it('provider 校验跑过但没通过 → 拒绝，携带 provider 给出的理由', () => {
    const providerCheck: ProviderCheckInput = { evaluated: true, passed: false, violations: ['Yoast meta 字段不可写'] }
    const result = validatePageChange(baseRequest(), OK_DIFF, AVAILABLE_NO_REDLINES, providerCheck)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.violations).toContain('Yoast meta 字段不可写')
  })
})

describe('validatePageChange · diff 不可用时诚实失败', () => {
  it('diff 是失败态 → validate 直接失败，不假装校验过', () => {
    const result = validatePageChange(baseRequest(), { ok: false, reason: 'diff 失败' }, AVAILABLE_NO_REDLINES, PASSED_PROVIDER_CHECK)
    expect(result.ok).toBe(false)
  })
})

describe('validatePageChange · 全部通过', () => {
  it('没有违规、红线可用且未命中、provider 校验通过 → 通过', () => {
    const result = validatePageChange(baseRequest(), OK_DIFF, AVAILABLE_NO_REDLINES, PASSED_PROVIDER_CHECK)
    expect(result.ok).toBe(true)
  })
})
