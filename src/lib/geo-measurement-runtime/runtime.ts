/**
 * Magic Engine 2.0 · GEO Measurement Runtime —— 批次编排（Issue #874 / WP04）
 *
 * 冻结运行链路（Build Control Room 2026-08-11 授权）：
 *   explicit frozen plan → budget preflight → bounded fake-provider execution
 *   → WP02 validation → atomic fake-store persistence → honest completed/partial/failed。
 *
 * 🔴 每一次可能收费的尝试 / 重试**之前**都重新做预算 preflight（授权第 4 条）。
 * 🔴 timeout / 网络歧义且 provider 无可靠幂等 → **不自动重放**，记诚实失败留待显式重试。
 * 🔴 provider 报回来的成本是**输入不是事实**：非有限 / 负数 / 超声明上界一律不采信，
 *    立即停跑，绝不让它污染预算账（否则 NaN 会让后续所有 preflight 静默放行）。
 * 🔴 provider 失败 / 超时 / 限流 / parser 失败**绝不写成成功**；成功观测**必带证据**。
 * 🔴 WP02 校验在**调用 store 之前**由本层直接执行 —— 契约校验不能只挂在某个具体 store 实现上。
 * 🔴 只调用注入的 provider/store（v1 = 假件）；不接生产库、不建 cron/API 入口。
 */

import { validateGeoEvidence, validateGeoObservation } from '@/lib/geo-measurement'
import type { GeoBatch, GeoObservation } from '@/lib/geo-measurement'
import { preflightBudget, trustProviderCost } from './budget'
import { buildFailedObservation, buildProviderRequest, buildSuccessObservation } from './observation'
import { validateFrozenPlan } from './plan'
import { checkCoverageMatchesRows, checkObservationEvidenceIntegrity } from './reconcile'
import {
  buildActualCoverage,
  buildComparabilityInputs,
  buildPlannedCoverage,
  computeBatchQuality,
  deriveStatus,
} from './summary'
import type {
  GeoEvidenceRecord,
  GeoFrozenPlan,
  GeoRuntimeDeps,
  GeoRuntimeResult,
  GeoStopReason,
} from './types'

/** runtime 内部 bug（不变式在落库前自检没过）。不是测量结论，是代码错误，必须炸出来。 */
export class GeoRuntimeInvariantError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'GeoRuntimeInvariantError'
    this.code = code
  }
}

/** 计划 / 依赖装配非法直接抛 —— fail closed，绝不带着半截 cohort 去调 provider。 */
export class GeoPlanRejectedError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'GeoPlanRejectedError'
    this.code = code
  }
}

interface CostLedger {
  knownSpent: number
  worstCaseSpent: number
  hasUnknownBilling: boolean
}

/** 为什么要停掉整批（而不是只判这一条观测失败）。 */
type RunStop = 'budget' | 'untrusted_cost'

type AttemptOutcome =
  | {
      readonly kind: 'observed'
      readonly observation: GeoObservation
      readonly evidence?: GeoEvidenceRecord
      readonly stop?: RunStop
    }
  | { readonly kind: 'budget_stop_before_call' }

interface AttemptArgs {
  plan: GeoFrozenPlan
  queryKey: string
  questionText: string
  sampleIndex: number
  batchId: string
  deps: GeoRuntimeDeps
  ledger: CostLedger
}

/**
 * 采信 provider 报回来的花费；不可信则把账记成「最坏情况 + 计费未知」并要求停跑。
 * 🔴 不可信的数**绝不进 knownSpent** —— 一个 NaN 进去，之后每一次 preflight 的比较
 *    都恒为 false，预算闸门就此静默失效。
 */
function absorbCost(ledger: CostLedger, reported: number, ceiling: number): { trusted: boolean; reason: string } {
  const verdict = trustProviderCost(reported, ceiling)
  if (verdict.trusted) {
    ledger.knownSpent += verdict.costUsd
    ledger.worstCaseSpent += verdict.costUsd
    return { trusted: true, reason: '' }
  }
  ledger.worstCaseSpent += Number.isFinite(ceiling) && ceiling >= 0 ? ceiling : 0
  ledger.hasUnknownBilling = true
  return { trusted: false, reason: verdict.reason }
}

/**
 * 跑单条观测：有界尝试循环，每次收费前重新 preflight。
 * 返回一条观测（成功或失败），或「预算不够、这条根本没发起」。
 */
async function attemptObservation(args: AttemptArgs): Promise<AttemptOutcome> {
  const { plan, deps, ledger } = args
  const request = buildProviderRequest(plan, args.queryKey, args.questionText, args.sampleIndex)
  const ceiling = plan.perObservationCostCeilingUsd
  let attemptedAtLeastOnce = false

  for (let attempt = 1; attempt <= plan.maxAttemptsPerObservation; attempt++) {
    const decision = preflightBudget(plan.budgetUsd - ledger.worstCaseSpent, ceiling)
    if (!decision.allowed) {
      if (!attemptedAtLeastOnce) return { kind: 'budget_stop_before_call' }
      return {
        kind: 'observed',
        observation: failObs(args, 'budget_exhausted_no_retry', decision.reason),
        stop: 'budget',
      }
    }

    attemptedAtLeastOnce = true
    const result = await deps.provider.call(request)
    const attemptsRemain = attempt < plan.maxAttemptsPerObservation

    if (result.kind === 'ok') {
      const cost = absorbCost(ledger, result.costUsd, ceiling)
      if (!cost.trusted) {
        return { kind: 'observed', observation: failObs(args, 'provider_cost_untrusted', cost.reason), stop: 'untrusted_cost' }
      }
      return { kind: 'observed', ...resolveOk(args, result.rawResponse, request) }
    }
    if (result.kind === 'error') {
      const cost = absorbCost(ledger, result.costUsd, ceiling)
      if (!cost.trusted) {
        return { kind: 'observed', observation: failObs(args, 'provider_cost_untrusted', cost.reason), stop: 'untrusted_cost' }
      }
      return { kind: 'observed', observation: failObs(args, result.errorCode, result.message) }
    }
    if (result.kind === 'rate_limited') {
      if (attemptsRemain) continue // 限流未收费，重放安全，下一轮重新 preflight
      return { kind: 'observed', observation: failObs(args, 'rate_limited', result.message) }
    }

    // timeout：计费歧义。报了具体金额也要验，报不出就按上界计最坏情况。
    if (result.costUsd.known) {
      const cost = absorbCost(ledger, result.costUsd.value, ceiling)
      if (!cost.trusted) {
        return { kind: 'observed', observation: failObs(args, 'provider_cost_untrusted', cost.reason), stop: 'untrusted_cost' }
      }
    } else {
      ledger.worstCaseSpent += ceiling
      ledger.hasUnknownBilling = true
    }
    const canReplay = deps.provider.idempotency === 'supported' && attemptsRemain
    if (canReplay) continue
    const code = deps.provider.idempotency === 'supported' ? 'provider_timeout' : 'provider_timeout_ambiguous_no_replay'
    return { kind: 'observed', observation: failObs(args, code, result.message) }
  }
  // 理论到不了（循环内一定 return）；防御性写一条失败，绝不静默丢观测。
  return { kind: 'observed', observation: failObs(args, 'exhausted_attempts', 'attempt loop exhausted') }
}

function resolveOk(
  args: AttemptArgs,
  rawResponse: string,
  request: ReturnType<typeof buildProviderRequest>,
): { observation: GeoObservation; evidence?: GeoEvidenceRecord } {
  const parsed = args.deps.parse(rawResponse, request)
  if (!parsed.ok) {
    return { observation: failObs(args, `parser_failure:${parsed.errorCode}`, parsed.message) }
  }
  const built = buildSuccessObservation({
    plan: args.plan,
    queryKey: args.queryKey,
    sampleIndex: args.sampleIndex,
    batchId: args.batchId,
    observationId: args.deps.newId('observation'),
    evidenceId: args.deps.newId('evidence'),
    observedAt: args.deps.now(),
    confidence: parsed.confidence,
    citations: parsed.citations,
    rawResponse,
  })
  return { observation: built.observation, evidence: built.evidence }
}

function failObs(args: AttemptArgs, errorCode: string, errorMessage: string): GeoObservation {
  return buildFailedObservation({
    plan: args.plan,
    queryKey: args.queryKey,
    sampleIndex: args.sampleIndex,
    batchId: args.batchId,
    observationId: args.deps.newId('observation'),
    observedAt: args.deps.now(),
    errorCode,
    errorMessage,
  })
}

function buildStopReason(args: {
  stop: RunStop | undefined
  observationCount: number
  status: GeoBatch['status']
  errorCodes: readonly string[]
}): GeoStopReason {
  const observedErrorCodes = Array.from(new Set(args.errorCodes)).sort()
  if (args.stop === 'untrusted_cost') {
    return {
      code: 'provider_cost_untrusted',
      detail: 'stopped: provider reported a cost that cannot be trusted; no further provider calls were made',
      observedErrorCodes,
    }
  }
  if (args.stop === 'budget') {
    const code = args.observationCount === 0 ? 'budget_exhausted_before_first_call' : 'budget_exhausted_mid_run'
    return { code, detail: 'stopped: remaining authorization below next-call upper bound', observedErrorCodes }
  }
  if (args.status === 'completed') {
    return { code: 'plan_completed', detail: 'every planned observation attempted and succeeded', observedErrorCodes }
  }
  if (args.status === 'failed') {
    return { code: 'all_attempts_failed', detail: 'no observation succeeded', observedErrorCodes }
  }
  return { code: 'partial_failures', detail: 'some observations failed or were not attempted', observedErrorCodes }
}

/**
 * 跑一批 GEO 测量（对着注入的 provider/store，v1 = 假件）。
 * 返回诚实终态；成功路径会原子落库。落库失败会抛出（store 保证一行都不写）。
 */
export async function runGeoMeasurementBatch(plan: GeoFrozenPlan, deps: GeoRuntimeDeps): Promise<GeoRuntimeResult> {
  const validation = validateFrozenPlan(plan)
  if (!validation.ok) throw new GeoPlanRejectedError(validation.code, validation.reason)

  // 🔴 装配闸：注入的 provider 必须就是计划声明的那个引擎。
  //    不一致的话，跑出来的观测会**如实**记着计划里的 engine_family，而数据其实来自
  //    另一个引擎 —— 一批身份是假的证据，且不可变、永远修不掉。必须在**第一次调用之前**拦。
  if (deps.provider.engineFamily !== plan.engineFamily) {
    throw new GeoPlanRejectedError(
      'provider_engine_mismatch',
      `injected provider engineFamily "${deps.provider.engineFamily}" does not match plan engineFamily "${plan.engineFamily}"; refusing to run`,
    )
  }

  const batchId = deps.newId('batch')
  const startedAt = deps.now()
  const ledger: CostLedger = { knownSpent: 0, worstCaseSpent: 0, hasUnknownBilling: false }
  const observations: GeoObservation[] = []
  const evidence: GeoEvidenceRecord[] = []
  const errorCodes: string[] = []
  let stop: RunStop | undefined

  outer: for (const query of plan.queries) {
    for (let sampleIndex = 0; sampleIndex < plan.sampleCount; sampleIndex++) {
      const outcome = await attemptObservation({
        plan,
        queryKey: query.queryKey,
        questionText: query.questionText,
        sampleIndex,
        batchId,
        deps,
        ledger,
      })
      if (outcome.kind === 'budget_stop_before_call') {
        stop = 'budget'
        break outer
      }
      observations.push(outcome.observation)
      if (outcome.evidence) evidence.push(outcome.evidence)
      if (!outcome.observation.outcome.ok) errorCodes.push(outcome.observation.outcome.errorCode)
      if (outcome.stop) {
        stop = outcome.stop
        break outer
      }
    }
  }

  const plannedCoverage = buildPlannedCoverage({
    engineFamily: plan.engineFamily,
    modelVersion: plan.modelVersion,
    locale: plan.locale,
    market: plan.market,
    queryKeys: plan.queries.map((q) => q.queryKey),
    plannedObservationCount: validation.plannedObservationCount,
  })
  const actualCoverage = buildActualCoverage(observations)
  const status = deriveStatus(plannedCoverage, actualCoverage)

  assertPersistable(observations, evidence, actualCoverage)

  const batch: GeoBatch = {
    batchId,
    querySetVersion: plan.querySetVersion,
    startedAt,
    completedAt: { known: true, value: deps.now() },
    status,
    plannedCoverage,
    actualCoverage,
    costUsd: ledger.hasUnknownBilling
      ? { known: false, reason: 'source_ambiguous' }
      : { known: true, value: ledger.knownSpent },
    triggeredBy: plan.triggeredBy,
  }

  await deps.store.persistBatch({
    clientId: plan.clientId,
    querySetId: plan.querySetId,
    batch,
    observations,
    evidence,
  })

  const quality = computeBatchQuality(actualCoverage, observations)
  return {
    status,
    batchId,
    persisted: true,
    plannedCoverage,
    actualCoverage,
    costUsd: batch.costUsd,
    stopReason: buildStopReason({ stop, observationCount: observations.length, status, errorCodes }),
    comparabilityInputs: buildComparabilityInputs(observations, quality),
  }
}

/**
 * 落库前自检：WP02 契约校验 + 观测/证据一一对应 + 覆盖账与行数一致。
 *
 * 🔴 WP02 校验在**这一层**跑，不是只靠 store 实现顺手验一下 —— 换一个 store（真实的那个）
 *    就把契约闸门一起换掉了，那是把「证据必须合契约」寄托在实现细节上。
 */
function assertPersistable(
  observations: readonly GeoObservation[],
  evidence: readonly GeoEvidenceRecord[],
  actual: { attempted: number; succeeded: number; failed: number },
): void {
  for (const o of observations) {
    const r = validateGeoObservation(o)
    if (!r.ok) throw new GeoRuntimeInvariantError('invalid_observation', `observation ${o.observationId}: ${r.reason}`)
  }
  for (const rec of evidence) {
    const r = validateGeoEvidence(rec.evidence)
    if (!r.ok) throw new GeoRuntimeInvariantError('invalid_evidence', `evidence ${rec.evidence.evidenceId}: ${r.reason}`)
    // 成功证据必须带真实原文 —— 一个没有正文兜底的定位符落库就是指向空气的地址。
    if (rec.evidence.rawResponseLocator.known && !rec.rawResponse.known) {
      throw new GeoRuntimeInvariantError(
        'evidence_locator_without_backing_data',
        `evidence ${rec.evidence.evidenceId} claims a locator but carries no raw response`,
      )
    }
  }
  const domainEvidence = evidence.map((r) => r.evidence)
  const integrity = checkObservationEvidenceIntegrity(observations, domainEvidence)
  if (!integrity.ok) throw new GeoRuntimeInvariantError(integrity.code, integrity.reason)
  const coverage = checkCoverageMatchesRows({
    claimedAttempted: actual.attempted,
    claimedSucceeded: actual.succeeded,
    claimedFailed: actual.failed,
    observations,
    evidence: domainEvidence,
  })
  if (!coverage.ok) throw new GeoRuntimeInvariantError(coverage.code, coverage.reason)
}
