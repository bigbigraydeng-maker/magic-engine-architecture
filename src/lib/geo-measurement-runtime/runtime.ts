/**
 * Magic Engine 2.0 · GEO Measurement Runtime —— 批次编排（Issue #874 / WP04）
 *
 * 冻结运行链路（Build Control Room 2026-08-11 授权）：
 *   explicit frozen plan → budget preflight → bounded fake-provider execution
 *   → WP02 validation → atomic fake-store persistence → honest completed/partial/failed。
 *
 * 🔴 每一次可能收费的尝试 / 重试**之前**都重新做预算 preflight（授权第 4 条）。
 * 🔴 timeout / 网络歧义且 provider 无可靠幂等 → **不自动重放**，记诚实失败留待显式重试。
 * 🔴 provider 失败 / 超时 / 限流 / parser 失败**绝不写成成功**；成功观测**必带证据**。
 * 🔴 只调用注入的 provider/store（v1 = 假件）；不接生产库、不建 cron/API 入口。
 */

import type { GeoBatch, GeoEvidence, GeoObservation } from '@/lib/geo-measurement'
import { preflightBudget } from './budget'
import {
  buildFailedObservation,
  buildProviderRequest,
  buildSuccessObservation,
} from './observation'
import { validateFrozenPlan } from './plan'
import { checkCoverageMatchesRows, checkObservationEvidenceIntegrity } from './reconcile'
import {
  buildActualCoverage,
  buildComparabilityInputs,
  buildPlannedCoverage,
  computeBatchQuality,
  deriveStatus,
} from './summary'
import type { GeoFrozenPlan, GeoRuntimeDeps, GeoRuntimeResult, GeoStopReason } from './types'

/** runtime 内部 bug（不变式在落库前自检没过）。不是测量结论，是代码错误，必须炸出来。 */
export class GeoRuntimeInvariantError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'GeoRuntimeInvariantError'
    this.code = code
  }
}

/** 计划非法直接抛 —— fail closed，绝不带着半截 cohort 去调 provider。 */
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

type AttemptOutcome =
  | { readonly kind: 'observed'; readonly observation: GeoObservation; readonly evidence?: GeoEvidence; readonly budgetStopped: boolean }
  | { readonly kind: 'budget_stop_before_call' }

/**
 * 跑单条观测：有界尝试循环，每次收费前重新 preflight。
 * 返回一条观测（成功或失败），或「预算不够、这条根本没发起」。
 */
async function attemptObservation(args: {
  plan: GeoFrozenPlan
  queryKey: string
  questionText: string
  sampleIndex: number
  batchId: string
  deps: GeoRuntimeDeps
  ledger: CostLedger
}): Promise<AttemptOutcome> {
  const { plan, deps, ledger } = args
  const request = buildProviderRequest(plan, args.queryKey, args.questionText, args.sampleIndex)
  let attemptedAtLeastOnce = false

  for (let attempt = 1; attempt <= plan.maxAttemptsPerObservation; attempt++) {
    const decision = preflightBudget(plan.budgetUsd - ledger.worstCaseSpent, plan.perObservationCostCeilingUsd)
    if (!decision.allowed) {
      if (!attemptedAtLeastOnce) return { kind: 'budget_stop_before_call' }
      const obs = failObs(args, 'budget_exhausted_no_retry', decision.reason)
      return { kind: 'observed', observation: obs, budgetStopped: true }
    }

    attemptedAtLeastOnce = true
    const result = await deps.provider.call(request)
    const attemptsRemain = attempt < plan.maxAttemptsPerObservation

    if (result.kind === 'ok') {
      ledger.knownSpent += result.costUsd
      ledger.worstCaseSpent += result.costUsd
      return { kind: 'observed', ...resolveOk(args, result.rawResponse, request), budgetStopped: false }
    }
    if (result.kind === 'error') {
      ledger.knownSpent += result.costUsd
      ledger.worstCaseSpent += result.costUsd
      return { kind: 'observed', observation: failObs(args, result.errorCode, result.message), budgetStopped: false }
    }
    if (result.kind === 'rate_limited') {
      if (attemptsRemain) continue // 限流未收费，重放安全，下一轮重新 preflight
      return { kind: 'observed', observation: failObs(args, 'rate_limited', result.message), budgetStopped: false }
    }
    // timeout：计费歧义，最坏情况计账
    if (result.costUsd.known) {
      ledger.knownSpent += result.costUsd.value
      ledger.worstCaseSpent += result.costUsd.value
    } else {
      ledger.worstCaseSpent += plan.perObservationCostCeilingUsd
      ledger.hasUnknownBilling = true
    }
    const canReplay = deps.provider.idempotency === 'supported' && attemptsRemain
    if (canReplay) continue
    const code = deps.provider.idempotency === 'supported' ? 'provider_timeout' : 'provider_timeout_ambiguous_no_replay'
    return { kind: 'observed', observation: failObs(args, code, result.message), budgetStopped: false }
  }
  // 理论到不了（循环内一定 return）；防御性写一条失败，绝不静默丢观测。
  return { kind: 'observed', observation: failObs(args, 'exhausted_attempts', 'attempt loop exhausted'), budgetStopped: false }
}

function resolveOk(
  args: { plan: GeoFrozenPlan; queryKey: string; sampleIndex: number; batchId: string; deps: GeoRuntimeDeps },
  rawResponse: string,
  request: ReturnType<typeof buildProviderRequest>,
): { observation: GeoObservation; evidence?: GeoEvidence } {
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
  })
  return { observation: built.observation, evidence: built.evidence }
}

function failObs(
  args: { plan: GeoFrozenPlan; queryKey: string; sampleIndex: number; batchId: string; deps: GeoRuntimeDeps },
  errorCode: string,
  errorMessage: string,
): GeoObservation {
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
  budgetStopped: boolean
  observationCount: number
  status: GeoBatch['status']
  errorCodes: readonly string[]
}): GeoStopReason {
  const observedErrorCodes = Array.from(new Set(args.errorCodes)).sort()
  if (args.budgetStopped) {
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

  const batchId = deps.newId('batch')
  const startedAt = deps.now()
  const ledger: CostLedger = { knownSpent: 0, worstCaseSpent: 0, hasUnknownBilling: false }
  const observations: GeoObservation[] = []
  const evidence: GeoEvidence[] = []
  const errorCodes: string[] = []
  let budgetStopped = false

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
        budgetStopped = true
        break outer
      }
      observations.push(outcome.observation)
      if (outcome.evidence) evidence.push(outcome.evidence)
      if (!outcome.observation.outcome.ok) errorCodes.push(outcome.observation.outcome.errorCode)
      if (outcome.budgetStopped) {
        budgetStopped = true
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

  await deps.store.persistBatch({ clientId: plan.clientId, batch, observations, evidence })

  const quality = computeBatchQuality(actualCoverage, observations)
  return {
    status,
    batchId,
    persisted: true,
    plannedCoverage,
    actualCoverage,
    costUsd: batch.costUsd,
    stopReason: buildStopReason({ budgetStopped, observationCount: observations.length, status, errorCodes }),
    comparabilityInputs: buildComparabilityInputs(observations, quality),
  }
}

/** 落库前自检：观测/证据一一对应 + 覆盖账与行数一致。不过 = runtime bug，当场炸。 */
function assertPersistable(
  observations: readonly GeoObservation[],
  evidence: readonly GeoEvidence[],
  actual: { attempted: number; succeeded: number; failed: number },
): void {
  const integrity = checkObservationEvidenceIntegrity(observations, evidence)
  if (!integrity.ok) throw new GeoRuntimeInvariantError(integrity.code, integrity.reason)
  const coverage = checkCoverageMatchesRows({
    claimedAttempted: actual.attempted,
    claimedSucceeded: actual.succeeded,
    claimedFailed: actual.failed,
    observations,
    evidence,
  })
  if (!coverage.ok) throw new GeoRuntimeInvariantError(coverage.code, coverage.reason)
}
