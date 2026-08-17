import { describe, it, expect } from 'vitest'
import {
  validateScanRequest,
  MAX_SEEDS_PER_REQUEST,
  MAX_RESULTS_CAP,
  MAX_ENRICH_CAP,
} from '../scan-request'

/** 合法基准请求（PM 费率）。 */
function base(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    seeds: ['portable blender'],
    market: 'NZ',
    assumptions: {
      fxUsdToNzd: 1.6981, freightNzdPerKg: 2.0, importLevyNzd: 2.21, dutyRatePct: 0,
      domesticDeliveryNzd: 3.99, paymentFeePct: 2.9, paymentFeeFixedNzd: 0.3,
      gstRatePct: 15, asOf: '2026-08-15',
    },
    opts: { maxResults: 10, enrichCount: 3 },
    ...over,
  }
}

describe('validateScanRequest — 正常路径', () => {
  it('合法请求通过并组装出 ScanRequest', () => {
    const r = validateScanRequest(base())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.seeds).toEqual(['portable blender'])
      expect(r.value.market).toBe('NZ')
      expect(r.value.maxResults).toBe(10)
      expect(r.value.assumptions.fxUsdToNzd).toBe(1.6981)
    }
  })

  it('缺 opts → 用默认 10/3', () => {
    const r = validateScanRequest(base({ opts: undefined }))
    expect(r.ok && r.value.maxResults).toBe(10)
    expect(r.ok && r.value.enrichCount).toBe(3)
  })

  it('种子词去重（大小写归一）+ trim', () => {
    const r = validateScanRequest(base({ seeds: ['Dash Cam', ' dash cam ', 'phone stand'] }))
    expect(r.ok && r.value.seeds).toEqual(['Dash Cam', 'phone stand'])
  })
})

describe('🔴 花钱封顶', () => {
  it('种子词超上限 → 拒（不静默截断）', () => {
    const many = Array.from({ length: MAX_SEEDS_PER_REQUEST + 1 }, (_, i) => `word${i}`)
    const r = validateScanRequest(base({ seeds: many }))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('花钱封顶')
  })

  it('maxResults 超上限 → 拒', () => {
    const r = validateScanRequest(base({ opts: { maxResults: MAX_RESULTS_CAP + 1, enrichCount: 3 } }))
    expect(r.ok).toBe(false)
  })

  it('enrichCount 超上限 → 拒', () => {
    const r = validateScanRequest(base({ opts: { maxResults: 10, enrichCount: MAX_ENRICH_CAP + 1 } }))
    expect(r.ok).toBe(false)
  })

  it('enrichCount > maxResults → 拒', () => {
    const r = validateScanRequest(base({ opts: { maxResults: 2, enrichCount: 5 } }))
    expect(r.ok).toBe(false)
  })
})

describe('🔴 防污染：成本假设逐字段校验', () => {
  it('汇率为负 → 拒（否则到岸成本算成负数、毛利虚高）', () => {
    const r = validateScanRequest(base({ assumptions: { ...(base().assumptions as object), fxUsdToNzd: -1 } }))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('fxUsdToNzd')
  })

  it('汇率 0 → 拒', () => {
    const r = validateScanRequest(base({ assumptions: { ...(base().assumptions as object), fxUsdToNzd: 0 } }))
    expect(r.ok).toBe(false)
  })

  it('汇率荒谬高（9999）→ 拒', () => {
    const r = validateScanRequest(base({ assumptions: { ...(base().assumptions as object), fxUsdToNzd: 9999 } }))
    expect(r.ok).toBe(false)
  })

  it('GST 被改成 0 → 拒（NZ GST 固定区间）', () => {
    const r = validateScanRequest(base({ assumptions: { ...(base().assumptions as object), gstRatePct: 0 } }))
    expect(r.ok).toBe(false)
  })

  it('缺 asOf → 拒（取数日期必须跟结果一起展示）', () => {
    const a = { ...(base().assumptions as Record<string, unknown>) }
    delete a.asOf
    const r = validateScanRequest(base({ assumptions: a }))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('asOf')
  })

  it('缺某个成本字段 → 拒', () => {
    const a = { ...(base().assumptions as Record<string, unknown>) }
    delete a.freightNzdPerKg
    const r = validateScanRequest(base({ assumptions: a }))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('freightNzdPerKg')
  })
})

describe('市场与结构', () => {
  it('AU 市场 → 拒（v1 只 NZ）', () => {
    const r = validateScanRequest(base({ market: 'AU' }))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('NZ')
  })

  it('seeds 为空数组 → 拒', () => {
    expect(validateScanRequest(base({ seeds: [] })).ok).toBe(false)
  })

  it('非对象请求体 → 拒，不抛错', () => {
    expect(validateScanRequest(null).ok).toBe(false)
    expect(validateScanRequest('nope').ok).toBe(false)
    expect(validateScanRequest(42).ok).toBe(false)
  })
})
