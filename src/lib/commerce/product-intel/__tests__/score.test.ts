import { describe, it, expect } from 'vitest'
import { scoreCandidate, rankCandidates } from '../score'
import type {
  MarketDemand,
  Measured,
  ProductCandidate,
  SourcingEvidence,
} from '../types'

const AT = '2026-08-15T00:00:00.000Z'

function m<T>(value: T | null): Measured<T> {
  return { value, provenance: 'observed', source: 'test', collectedAt: AT }
}

function demand(
  market: 'AU' | 'NZ',
  searches: number | null,
  trajectory: 'rising' | 'flat' | 'declining' | null,
): MarketDemand {
  return {
    market,
    monthlySearches: m(searches),
    trajectory: m(trajectory),
    cpcUsd: m<number>(null),
    competition: m<number>(null),
  }
}

function sourcing(costUsd: number | null): SourcingEvidence {
  return {
    medianUnitCostUsd: { value: costUsd, provenance: 'derived', source: 'test', collectedAt: AT },
    matchCount: m(costUsd === null ? 0 : 10),
    minOrderQty: m(2),
    topSuppliers: ['Foshan Test Furniture Co., Ltd.'],
  }
}

function candidate(over: Partial<ProductCandidate> = {}): ProductCandidate {
  return {
    source: {
      provider: 'tiktok_shop_us',
      sourceProductId: 'p1',
      sourceUrl: 'https://www.tiktok.com/shop/pdp/p1',
      runId: 'run1',
      collectedAt: AT,
    },
    title: 'Portable Blender',
    retailPriceUsd: m(29.99),
    cumulativeSold: m(50_287),
    rating: m(4),
    imageUrl: 'https://example.test/a.jpg',
    sourcing: sourcing(4),
    demand: [demand('AU', 900, 'rising'), demand('NZ', 200, 'flat')],
    ...over,
  }
}

describe('四道闸', () => {
  it('证据齐全且都达标 → TEST_NOW', () => {
    const scored = scoreCandidate(candidate())
    expect(scored.verdict).toBe('TEST_NOW')
    expect(scored.gates.every((g) => g.outcome === 'PASS')).toBe(true)
  })

  it('累计销量不足 → REJECT（哪怕其他三道全过）', () => {
    const scored = scoreCandidate(candidate({ cumulativeSold: m(108) }))
    expect(scored.verdict).toBe('REJECT')
  })

  it('🔴 销量为 null（取不到）跟销量为 0（真没卖）走向必须相反', () => {
    const missing = scoreCandidate(candidate({ cumulativeSold: m<number>(null) }))
    const zero = scoreCandidate(candidate({ cumulativeSold: m(0) }))
    expect(missing.gates[0].outcome).toBe('UNKNOWN')
    expect(missing.verdict).toBe('UNKNOWN')
    expect(zero.gates[0].outcome).toBe('FAIL')
    expect(zero.verdict).toBe('REJECT')
  })

  it('澳新两地都在跌 → REJECT；只要有一地不跌就放行', () => {
    const bothDown = candidate({
      demand: [demand('AU', 900, 'declining'), demand('NZ', 200, 'declining')],
    })
    expect(scoreCandidate(bothDown).verdict).toBe('REJECT')

    const oneFlat = candidate({
      demand: [demand('AU', 900, 'declining'), demand('NZ', 200, 'flat')],
    })
    expect(scoreCandidate(oneFlat).verdict).toBe('TEST_NOW')
  })

  it('搜索量按 AU+NZ 合计判，不是各自判', () => {
    const split = candidate({
      demand: [demand('AU', 150, 'flat'), demand('NZ', 120, 'flat')],
    })
    const gate = scoreCandidate(split).gates.find((g) => g.gate === 'aunz_searched')
    expect(gate?.outcome).toBe('PASS')
    expect(gate?.reason).toContain('270')
  })

  it('毛利不足 6 倍 → REJECT（新西兰固定成本高，3 倍不够）', () => {
    const thin = candidate({ retailPriceUsd: m(12), sourcing: sourcing(3) })
    expect(scoreCandidate(thin).verdict).toBe('REJECT')
  })

  it('🔴 没找到货源 → 毛利判 UNKNOWN，整体降级成 WATCH 而不是 REJECT', () => {
    const noSource = scoreCandidate(candidate({ sourcing: null }))
    const marginGate = noSource.gates.find((g) => g.gate === 'margin_multiple')
    expect(marginGate?.outcome).toBe('UNKNOWN')
    expect(noSource.verdict).toBe('WATCH')
  })

  it('🔴 核心闸 UNKNOWN 不许降级成 WATCH', () => {
    const noVolume = scoreCandidate(candidate({
      demand: [demand('AU', null, 'rising'), demand('NZ', null, 'flat')],
    }))
    expect(noVolume.verdict).toBe('UNKNOWN')
  })

  it('明确的 FAIL 压过 UNKNOWN —— 有硬伤就是排除，不是判不了', () => {
    const scored = scoreCandidate(candidate({
      cumulativeSold: m(10),
      sourcing: null,
    }))
    expect(scored.verdict).toBe('REJECT')
  })

  it('每条 reason 都带实际数值，不许是空话', () => {
    const gates = scoreCandidate(candidate()).gates
    expect(gates.find((g) => g.gate === 'proven_demand')?.reason).toContain('50,287')
    expect(gates.find((g) => g.gate === 'margin_multiple')?.reason).toContain('7.5×')
  })
})

describe('排序', () => {
  it('通过闸数优先于销量 —— 证据强度不是销量排行', () => {
    const strong = candidate({ cumulativeSold: m(1_500) })
    const weak = candidate({ cumulativeSold: m(900_000), sourcing: sourcing(25) })
    const ranked = rankCandidates([weak, strong])
    expect(ranked[0].candidate.cumulativeSold.value).toBe(1_500)
    expect(ranked[0].verdict).toBe('TEST_NOW')
  })
})
