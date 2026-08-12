/**
 * Magic Engine 2.0 · GEO Baseline —— 冻结计划的组装（Issue #883 / #917 · WP04A）
 *
 * 🔴 **这里不出现任何客户常量。** 每一个 cohort 维度都从调用方进来，一个默认值都没有。
 *    WP04 授权裁定第 2 条：没有隐藏的 sample-plan 默认值；WP00 §15：任何 WP 把未决项
 *    当既定假设直接实现，就是违反 WP00。Roman 的取值属未决项 R5 / M6 / M3，
 *    由 PM 在运行时提供，**不进代码**。
 *
 * 🔴 组装完立刻过 WP04 的 `validateFrozenPlan` —— 校验逻辑不在这里重写一份。
 */

import { validateFrozenPlan } from '@/lib/geo-measurement-runtime'
import type { GeoFrozenPlan } from '@/lib/geo-measurement-runtime'
import type { GeoFrozenQueryScope } from './types'

export class GeoPlanBuildError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'GeoPlanBuildError'
    this.code = code
  }
}

/** cohort 与预算的取值 —— 全部由 PM 冻结后从外部传入。 */
export interface GeoBaselineManifest {
  readonly clientId: string
  readonly engineFamily: string
  readonly modelVersion: string
  readonly locale: string
  readonly market: string
  readonly sampleCount: number
  readonly parserVersion: string
  readonly metricRulesVersion: string
  readonly budgetUsd: number
  readonly perObservationCostCeilingUsd: number
  readonly maxAttemptsPerObservation: number
  readonly triggeredBy: string
}

export interface GeoBuiltPlan {
  readonly plan: GeoFrozenPlan
  readonly plannedObservationCount: number
  /** 最坏情况总花费 = planned × 单次上界。跑之前就能算出来，不用「先跑完再看」。 */
  readonly worstCaseCostUsd: number
}

/**
 * 把「PM 冻结的 manifest」+「库里读出来的查询范围」拼成一份 `GeoFrozenPlan`。
 *
 * 校验不过直接抛 —— fail closed，绝不带着半截 cohort 去调 provider。
 */
export function buildFrozenPlan(manifest: GeoBaselineManifest, scope: GeoFrozenQueryScope): GeoBuiltPlan {
  const plan: GeoFrozenPlan = {
    clientId: manifest.clientId,
    querySetId: scope.querySetId,
    querySetVersion: scope.querySetVersion,
    queries: scope.queries.map((q) => ({ queryKey: q.queryKey, questionText: q.questionText })),
    engineFamily: manifest.engineFamily,
    modelVersion: manifest.modelVersion,
    locale: manifest.locale,
    market: manifest.market,
    sampleCount: manifest.sampleCount,
    // 🔴 采样参数：这一轮不设温度 / 种子。**拿不到就是显式未知**，不是 `{}`
    //    ——`{}` 会被下游读成「记录了、而且是空的」，那是另一个事实。
    samplingParameters: { known: false, reason: 'not_recorded_by_source' },
    parserVersion: manifest.parserVersion,
    metricRulesVersion: manifest.metricRulesVersion,
    budgetUsd: manifest.budgetUsd,
    perObservationCostCeilingUsd: manifest.perObservationCostCeilingUsd,
    maxAttemptsPerObservation: manifest.maxAttemptsPerObservation,
    triggeredBy: { known: true, value: manifest.triggeredBy },
  }

  const validation = validateFrozenPlan(plan)
  if (!validation.ok) {
    throw new GeoPlanBuildError(validation.code, `冻结计划不合法：${validation.reason}`)
  }
  return {
    plan,
    plannedObservationCount: validation.plannedObservationCount,
    worstCaseCostUsd: validation.plannedObservationCount * manifest.perObservationCostCeilingUsd,
  }
}

/**
 * 预算是否够跑满整个计划 —— **只是报告，不是闸**。
 *
 * 真正的闸在 WP04 的 `preflightBudget`，它在**每一次可能收费的尝试之前**都重判一次。
 * 这个函数只是让 dry-run 能提前把「这份计划最坏会花多少、批的额度够不够」摆给人看，
 * 免得跑到一半才发现只能跑一半。
 */
export function summariseBudgetHeadroom(built: GeoBuiltPlan): {
  readonly coversFullPlan: boolean
  readonly worstCaseCostUsd: number
  readonly budgetUsd: number
  readonly note: string
} {
  const coversFullPlan = built.worstCaseCostUsd <= built.plan.budgetUsd
  return {
    coversFullPlan,
    worstCaseCostUsd: built.worstCaseCostUsd,
    budgetUsd: built.plan.budgetUsd,
    note: coversFullPlan
      ? '预算足够跑满整个计划（按单次成本上界估最坏情况）'
      : '🔴 预算不足以跑满整个计划：会在中途停手并如实报「部分覆盖」——' +
        '按 GEO 契约 §7.2，部分覆盖的批次不许被呈现成一次完整基线。',
  }
}
