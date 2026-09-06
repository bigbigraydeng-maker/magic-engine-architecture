/**
 * Magic Engine 2.0 · GEO 验证判定层（Issue #1347 · IMPACT 的 Check 段）
 *
 * 🔴 **这个文件补的是「已冻结判据的执行侧」，不是新判据。** `verification.ts` 的
 *    `buildQualifiedMentionVerification` 早就在动作发生**之前**写下了三档判据
 *    （metricRef = `geo-module/m1/v1:qualified_mention_coverage`）；但全仓此前没有任何代码
 *    去执行它 —— 指标 key 在 `src/types/strategy.ts` 登记了一行，算它的代码不存在。
 *    结果是：ME 能测、能诊断，测完却判不出「动作到底有没有效果」。本文件把这一段接上。
 *
 * 🔴 **纯函数、零副作用。** 不落库、不调 provider、不复测、不碰页面。输入是两侧已经算好的
 *    覆盖账 + cohort 身份，输出是三档结论 + 机器可读原因码。真实取数由调用方负责。
 *
 * 🔴 **永不误判 failure（判据原文的硬约束）。** 冻结判据里写死：「测量层判为 not_comparable
 *    …… 或复测样本证据不足 —— 一律落 indeterminate，**永不落 failure**」。所以本层所有
 *    「拿不准」的路径全部收敛到 `indeterminate`，只有在两侧都可比、证据都够、且覆盖**确实
 *    下降**时才允许 failure。宁可判不出，不可错判客户「做砸了」。
 *
 * 🔴 **必须比「比率」而不是「绝对数」。** 两侧的可解释 query 数往往不同（defer 数量不同），
 *    13/18 → 9/12 绝对数在掉、比率在涨。比错了会把改进判成退步。
 *
 * 🔴 **关于整数交叉相乘的诚实说明（变异验证结论，勿当成 bug 修复）**：本层用
 *    `a*d vs c*b` 而非 `a/b vs c/d`。**但实测：把它换成浮点除法，全部测试仍然绿。**
 *    我穷举了 query 数 < 400 的全部整数比率对，没有任何一组会让两种实现给出不同结论 ——
 *    IEEE 754 的除法是正确舍入的，同一数学值必然舍入到同一个 double。
 *    所以整数写法是**稳健性冗余**（万一将来 query 数量级暴涨、或有人改成加权计数），
 *    **不是**在修复某个已知精度 bug。不要因为这段注释就以为浮点版本有错。
 */

import { evaluateGeoComparability } from '@/lib/geo-measurement'
import type { GeoComparabilityCohortInput, GeoComparabilityMismatch } from '@/lib/geo-measurement'
import { GEO_M1_RULE_VERSION } from './types'
import type { GeoCoverageSummary } from './types'

/** 判定结论三档 —— 与冻结判据 `criteria` 的三个键一一对应，不新增第四档。 */
export type GeoVerificationVerdict = 'success' | 'failure' | 'indeterminate'

/**
 * 机器可读原因码。**只用枚举不用自由文本** —— 审计要能按原因分组统计
 * （照 M1 `GeoM1ReasonCode` 的既有形态）。
 */
export type GeoVerificationReasonCode =
  /** 两侧解释身份（规则版本）对不上 —— 拿不同的尺子量出来的数不能比。 */
  | 'rule_version_mismatch'
  /** 测量层 `evaluateGeoComparability` 判不可比（采集身份 / 解释身份 / 质量阈值任一不过）。 */
  | 'not_comparable'
  /** 基线侧可解释 query 为 0 —— 没有分母，算不出覆盖率。 */
  | 'insufficient_baseline_evidence'
  /** 复测侧可解释 query 为 0 —— 同上。 */
  | 'insufficient_followup_evidence'
  /** 合格提及覆盖率相对基线上升。 */
  | 'mention_coverage_increased'
  /** 合格提及覆盖率相对基线下降。 */
  | 'mention_coverage_decreased'
  /** 合格提及覆盖率与基线持平 —— 既不算成功也不算失败。 */
  | 'mention_coverage_unchanged'
  /** explicit_positive 覆盖率下降 —— 判据要求它「不下降」才允许 success。 */
  | 'explicit_positive_decreased'

/** 一侧的输入：已经算好的覆盖账 + 该批次的 cohort 身份。 */
export interface GeoVerificationSide {
  readonly coverage: GeoCoverageSummary
  readonly cohort: GeoComparabilityCohortInput
}

export interface GeoVerificationInput {
  readonly baseline: GeoVerificationSide
  readonly followUp: GeoVerificationSide
}

/** 一个比率的可读呈现。`known:false` 时带上为什么算不出，绝不补 0。 */
export type GeoRate =
  | { readonly known: true; readonly numerator: number; readonly denominator: number }
  | { readonly known: false; readonly reason: 'no_interpretable_queries' }

export interface GeoVerificationOutcome {
  readonly verdict: GeoVerificationVerdict
  /** 去重保序。多道闸可能对同一情形各记一次，审计读起来不该有重复噪声。 */
  readonly reasonCodes: readonly GeoVerificationReasonCode[]
  /** 与 finding / verification 定义同一把尺子，便于回溯是哪个指标下的判定。 */
  readonly metricRef: string
  /** 两侧的原始比率，供人工复核；judge 不藏计算过程。 */
  readonly measured: {
    readonly baselineMention: GeoRate
    readonly followUpMention: GeoRate
    readonly baselineExplicitPositive: GeoRate
    readonly followUpExplicitPositive: GeoRate
  }
  /** 不可比时把测量层给出的具体不匹配项透传出来，便于定位是哪一项对不上。 */
  readonly comparabilityMismatches?: readonly GeoComparabilityMismatch[]
}

/** 原因码去重（保序）。 */
function dedupe(codes: readonly GeoVerificationReasonCode[]): GeoVerificationReasonCode[] {
  return Array.from(new Set(codes))
}

function rateOf(numerator: number, denominator: number): GeoRate {
  return denominator > 0
    ? { known: true, numerator, denominator }
    : { known: false, reason: 'no_interpretable_queries' }
}

/**
 * 比较两个比率。返回 1 = right 比 left 高；-1 = 低；0 = 持平。
 *
 * 🔴 用整数交叉相乘是稳健性选择，不是精度修复 —— 见文件头的诚实说明。
 *    调用方保证两个分母都 > 0（闸 3 已挡住 0）。
 */
function compareRates(
  leftNum: number,
  leftDen: number,
  rightNum: number,
  rightDen: number,
): -1 | 0 | 1 {
  // left/leftDen vs right/rightDen  ⇔  left*rightDen vs right*leftDen（两个分母都 > 0）
  const l = leftNum * rightDen
  const r = rightNum * leftDen
  if (r > l) return 1
  if (r < l) return -1
  return 0
}

function measuredOf(input: GeoVerificationInput): GeoVerificationOutcome['measured'] {
  const b = input.baseline.coverage
  const f = input.followUp.coverage
  return {
    baselineMention: rateOf(b.qualifiedMentionQueries, b.interpretableQueries),
    followUpMention: rateOf(f.qualifiedMentionQueries, f.interpretableQueries),
    baselineExplicitPositive: rateOf(b.explicitPositiveQueries, b.interpretableQueries),
    followUpExplicitPositive: rateOf(f.explicitPositiveQueries, f.interpretableQueries),
  }
}

/**
 * 执行冻结的合格提及覆盖判据，给出三档结论。
 *
 * 判定顺序（**fail-closed**，任一道闸不过就直接落 indeterminate，绝不继续往下算）：
 *   1. 两侧规则版本相同吗？—— 不同 = 拿不同尺子量的，不可比
 *   2. 测量层判可比吗？—— `evaluateGeoComparability`（采集身份 + 解释身份 + 质量阈值）
 *   3. 两侧都有可解释 query 吗？—— 分母为 0 算不出覆盖率
 *   4. 比合格提及覆盖率：下降 → failure；上升 → 还要看 explicit_positive 不下降才 success
 *
 * 🔴 **判据空隙的保守填充（本层的判断，非判据原文，复审请重点挑这两条）**：
 *    冻结判据只写死了三种情形，以下两种它没明说，本层一律落 `indeterminate`：
 *      · **提及覆盖持平** —— 不是「上升」（不满足 success），也不是「明确下降」（不满足 failure）。
 *      · **提及上升但 explicit_positive 下降** —— success 要求两个条件**同时**成立，缺一不可；
 *        但 failure 只看提及是否下降，此时提及在涨，判 failure 会是误判。
 *    两种都收敛到 indeterminate，符合「永不落 failure」的硬约束方向。
 */
export function evaluateQualifiedMentionVerdict(
  input: GeoVerificationInput,
): GeoVerificationOutcome {
  const metricRef = `${GEO_M1_RULE_VERSION}:qualified_mention_coverage`
  const measured = measuredOf(input)
  const b = input.baseline.coverage
  const f = input.followUp.coverage

  // ── 闸 1：解释身份（规则版本）必须一致 ──
  if (b.ruleVersion !== f.ruleVersion) {
    return {
      verdict: 'indeterminate',
      reasonCodes: ['rule_version_mismatch'],
      metricRef,
      measured,
    }
  }

  // ── 闸 2：测量层可比性（采集身份 / 解释身份 / 质量阈值，阈值由 v1 政策冻结） ──
  const comparability = evaluateGeoComparability(input.baseline.cohort, input.followUp.cohort)
  if (!comparability.comparable) {
    return {
      verdict: 'indeterminate',
      reasonCodes: ['not_comparable'],
      metricRef,
      measured,
      comparabilityMismatches: comparability.mismatches,
    }
  }

  // ── 闸 3：两侧都要有分母。0 个可解释 query = 证据不足，不是「覆盖率 0」 ──
  const evidenceGaps: GeoVerificationReasonCode[] = []
  if (b.interpretableQueries <= 0) evidenceGaps.push('insufficient_baseline_evidence')
  if (f.interpretableQueries <= 0) evidenceGaps.push('insufficient_followup_evidence')
  if (evidenceGaps.length > 0) {
    return { verdict: 'indeterminate', reasonCodes: dedupe(evidenceGaps), metricRef, measured }
  }

  // ── 闸 4：比覆盖率（整数交叉相乘，无浮点） ──
  const mentionDelta = compareRates(
    b.qualifiedMentionQueries,
    b.interpretableQueries,
    f.qualifiedMentionQueries,
    f.interpretableQueries,
  )

  if (mentionDelta < 0) {
    // 提及覆盖明确下降，且前面三道闸都通过（两侧可比、证据充足）→ 判据原文的 failure。
    return { verdict: 'failure', reasonCodes: ['mention_coverage_decreased'], metricRef, measured }
  }

  const explicitPositiveDelta = compareRates(
    b.explicitPositiveQueries,
    b.interpretableQueries,
    f.explicitPositiveQueries,
    f.interpretableQueries,
  )

  if (mentionDelta === 0) {
    // 判据空隙①：持平。既非上升亦非下降 → indeterminate。
    const codes: GeoVerificationReasonCode[] = ['mention_coverage_unchanged']
    if (explicitPositiveDelta < 0) codes.push('explicit_positive_decreased')
    return { verdict: 'indeterminate', reasonCodes: dedupe(codes), metricRef, measured }
  }

  // mentionDelta > 0：提及覆盖上升。success 还要求 explicit_positive 不下降。
  if (explicitPositiveDelta < 0) {
    // 判据空隙②：提及涨了但推荐掉了 → success 条件不全，也不能判 failure（提及在涨）。
    return {
      verdict: 'indeterminate',
      reasonCodes: dedupe(['mention_coverage_increased', 'explicit_positive_decreased']),
      metricRef,
      measured,
    }
  }

  return { verdict: 'success', reasonCodes: ['mention_coverage_increased'], metricRef, measured }
}
