/**
 * #1347 · GEO 验证判定层（IMPACT Check 段）。
 *
 * 覆盖四道 fail-closed 闸 + 两个判据空隙 + 整数比率（防浮点陷阱）+ 「永不误判 failure」硬约束。
 */
import { describe, it, expect } from 'vitest'
import { evaluateQualifiedMentionVerdict, type GeoVerificationSide } from '../verdict'
import { GEO_M1_RULE_VERSION } from '../types'
import type { GeoCoverageSummary } from '../types'
import type { GeoComparabilityCohortInput } from '@/lib/geo-measurement'

const K = <T,>(value: T) => ({ known: true, value }) as const

/** 采集身份 —— 每个字段都是 GeoMaybeUnknown 包装，不是裸值。 */
function acquisition(overrides: Record<string, unknown> = {}) {
  return {
    querySetVersion: K('cts_geo_baseline_v1'),
    queryKey: K('brand_01'),
    engineFamily: K('openai'),
    modelVersion: K('gpt-5-search-api-2025-10-14'),
    locale: K('en-NZ'),
    market: K('nz'),
    sample: {
      samplePlan: K({ plannedCount: 1 }),
      sampleIndex: K(0),
      samplingParameters: K({}),
    },
    ...overrides,
  }
}

/** 一份可比的 cohort 身份（质量三项都过 v1 冻结阈值：conf≥0.8 / 覆盖≥0.8 / 失败率≤0.2）。 */
function cohort(overrides: Record<string, unknown> = {}): GeoComparabilityCohortInput {
  return {
    acquisition: acquisition(),
    interpretation: {
      parserVersion: K('geo-baseline/parser/v1'),
      metricRulesVersion: K('geo-baseline/rules/v1'),
    },
    confidence: K(1),
    engineCoverage: K(1),
    failureRate: K(0),
    ...overrides,
  } as unknown as GeoComparabilityCohortInput
}

/** 一份覆盖账。只填判定用得上的字段，其余给中性值。 */
function coverage(
  interpretableQueries: number,
  qualifiedMentionQueries: number,
  explicitPositiveQueries: number,
  ruleVersion: string = GEO_M1_RULE_VERSION,
): GeoCoverageSummary {
  return {
    ruleVersion,
    queryCount: interpretableQueries,
    interpretableQueries,
    qualifiedMentionQueries,
    explicitPositiveQueries,
    conditionalQueries: 0,
    fullyDeferredQueries: 0,
    perQuery: [],
  } as unknown as GeoCoverageSummary
}

function side(
  interpretable: number,
  mention: number,
  explicitPositive: number,
  cohortOverrides: Record<string, unknown> = {},
  ruleVersion?: string,
): GeoVerificationSide {
  return {
    coverage: coverage(interpretable, mention, explicitPositive, ruleVersion),
    cohort: cohort(cohortOverrides),
  }
}

describe('闸 1 · 解释身份（规则版本）不一致 → indeterminate', () => {
  it('两侧 ruleVersion 不同 → 不比数字，直接 indeterminate', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3),
      followUp: side(18, 17, 5, {}, 'geo-module/m1/v2'),
    })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toEqual(['rule_version_mismatch'])
  })
})

describe('闸 2 · 测量层判不可比 → indeterminate（永不 failure）', () => {
  it('查询集版本不同 → indeterminate，并透传 mismatch', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3),
      followUp: side(18, 5, 1, {
        acquisition: acquisition({ querySetVersion: K('cts_geo_baseline_v2') }), // ← 换了查询集
      }),
    })
    // 覆盖率从 13/18 掉到 5/18 —— 但不可比，**绝不允许**判 failure。
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('not_comparable')
    expect(r.comparabilityMismatches?.length ?? 0).toBeGreaterThan(0)
  })

  it('locale 不同 → indeterminate', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3),
      followUp: side(18, 16, 4, {
        acquisition: acquisition({ locale: K('en-AU') }), // ← 换了 locale
      }),
    })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('not_comparable')
  })

  it('质量阈值不过（失败率超上限）→ indeterminate', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3),
      followUp: side(18, 16, 4, { failureRate: K(0.5) }),
    })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('not_comparable')
  })
})

describe('闸 3 · 证据不足（分母为 0）→ indeterminate，绝不当成覆盖率 0', () => {
  it('基线可解释 query = 0 → insufficient_baseline_evidence', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(0, 0, 0),
      followUp: side(18, 13, 3),
    })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('insufficient_baseline_evidence')
    expect(r.measured.baselineMention).toEqual({ known: false, reason: 'no_interpretable_queries' })
  })

  it('复测可解释 query = 0 → insufficient_followup_evidence，不判 failure', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3),
      followUp: side(0, 0, 0),
    })
    // 复测什么都没测出来 ≠ 覆盖掉到 0。绝不能判 failure。
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('insufficient_followup_evidence')
  })

  it('两侧都为 0 → 两个原因码都出，去重后不重复', () => {
    const r = evaluateQualifiedMentionVerdict({ baseline: side(0, 0, 0), followUp: side(0, 0, 0) })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toEqual([
      'insufficient_baseline_evidence',
      'insufficient_followup_evidence',
    ])
  })
})

describe('闸 4 · 正常判定', () => {
  it('提及覆盖上升 + explicit_positive 不降 → success', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3),
      followUp: side(18, 16, 3),
    })
    expect(r.verdict).toBe('success')
    expect(r.reasonCodes).toEqual(['mention_coverage_increased'])
  })

  it('提及覆盖上升 + explicit_positive 也升 → success', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3),
      followUp: side(18, 16, 5),
    })
    expect(r.verdict).toBe('success')
  })

  it('提及覆盖明确下降（两侧可比、证据充足）→ failure', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3),
      followUp: side(18, 9, 3),
    })
    expect(r.verdict).toBe('failure')
    expect(r.reasonCodes).toEqual(['mention_coverage_decreased'])
  })

  it('分母不同也按比率比，不按绝对数（12/18 < 9/12 应判上升）', () => {
    // 绝对数 12 → 9 是「掉了」，但比率 0.667 → 0.75 是「涨了」。必须按比率。
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 12, 3),
      followUp: side(12, 9, 2),
    })
    expect(r.verdict).toBe('success')
    expect(r.reasonCodes).toEqual(['mention_coverage_increased'])
  })
})

describe('判据空隙的保守填充（本层判断，非判据原文）', () => {
  it('空隙①：提及覆盖持平 → indeterminate（既非上升也非明确下降）', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3),
      followUp: side(18, 13, 3),
    })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('mention_coverage_unchanged')
  })

  it('空隙①变体：比率持平但分母不同（13/18 vs 26/36）→ 仍判持平', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3),
      followUp: side(36, 26, 6),
    })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('mention_coverage_unchanged')
  })

  it('空隙②：提及涨了但 explicit_positive 跌了 → indeterminate，不判 failure 也不判 success', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 5),
      followUp: side(18, 16, 2),
    })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('mention_coverage_increased')
    expect(r.reasonCodes).toContain('explicit_positive_decreased')
  })

  it('持平 + explicit_positive 跌 → indeterminate，两个码都带上', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 5),
      followUp: side(18, 13, 2),
    })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('mention_coverage_unchanged')
    expect(r.reasonCodes).toContain('explicit_positive_decreased')
  })
})

/**
 * 🔴 本组测的是**比率等价性**，不是「防浮点陷阱」。
 *    变异验证实测：把实现换成浮点除法，本组全部仍绿 —— 在 query 数 < 400 的范围内
 *    两种实现等价（穷举验证过）。保留本组是为了钉住「按比率比、不按绝对数比」这条语义，
 *    不是为了证明整数实现修了什么 bug。
 */
describe('比率等价性（分母不同也要比对）', () => {
  it('1/3 vs 2/6 判持平', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(3, 1, 0),
      followUp: side(6, 2, 0),
    })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('mention_coverage_unchanged')
  })

  it('7/9 vs 70/90 判持平', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(9, 7, 0),
      followUp: side(90, 70, 0),
    })
    expect(r.reasonCodes).toContain('mention_coverage_unchanged')
  })

  it('相邻比率也能分出来：13/18 vs 14/19（≈0.7222 vs ≈0.7368）→ 上升', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 0),
      followUp: side(19, 14, 0),
    })
    expect(r.verdict).toBe('success')
  })
})

describe('输出契约', () => {
  it('metricRef 与冻结判据同一把尺子', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3),
      followUp: side(18, 16, 3),
    })
    expect(r.metricRef).toBe(`${GEO_M1_RULE_VERSION}:qualified_mention_coverage`)
  })

  it('measured 带回两侧原始分子分母，不藏计算过程', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3),
      followUp: side(20, 17, 4),
    })
    expect(r.measured.baselineMention).toEqual({ known: true, numerator: 13, denominator: 18 })
    expect(r.measured.followUpMention).toEqual({ known: true, numerator: 17, denominator: 20 })
    expect(r.measured.baselineExplicitPositive).toEqual({ known: true, numerator: 3, denominator: 18 })
    expect(r.measured.followUpExplicitPositive).toEqual({ known: true, numerator: 4, denominator: 20 })
  })

  it('可比时不带 comparabilityMismatches 字段', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3),
      followUp: side(18, 16, 3),
    })
    expect(r.comparabilityMismatches).toBeUndefined()
  })
})

describe('硬约束：永不误判 failure', () => {
  it('所有 indeterminate 路径下，即使覆盖大幅下降也绝不落 failure', () => {
    const bigDrop = { interpretable: 18, mention: 1, explicitPositive: 0 }
    const cases = [
      // 规则版本不同
      {
        baseline: side(18, 17, 5),
        followUp: side(bigDrop.interpretable, bigDrop.mention, bigDrop.explicitPositive, {}, 'geo-module/m1/v2'),
      },
      // 不可比（换查询集）
      {
        baseline: side(18, 17, 5),
        followUp: side(bigDrop.interpretable, bigDrop.mention, bigDrop.explicitPositive, {
          acquisition: acquisition({ querySetVersion: K('other_set') }),
        }),
      },
      // 复测证据不足
      { baseline: side(18, 17, 5), followUp: side(0, 0, 0) },
    ]
    for (const c of cases) {
      expect(evaluateQualifiedMentionVerdict(c).verdict).not.toBe('failure')
    }
  })
})
