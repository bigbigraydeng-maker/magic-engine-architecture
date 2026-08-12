/**
 * Magic Engine 2.0 · GEO Measurement Runtime —— 观测 / 证据构造（Issue #874 / WP04）
 *
 * 🔴 **纯函数。** 把「计划 + 样本序号 + 一次调用结果」翻成 WP02 契约形状的
 *    `GeoObservation` / `GeoEvidence`。构造完必须过 WP02 校验器（在 runtime 里做），
 *    这里只负责把身份维度**如实**填上，绝不补默认、绝不把失败美化成成功。
 */

import type {
  GeoAcquisitionIdentity,
  GeoCitation,
  GeoEvidence,
  GeoInterpretationIdentity,
  GeoObservation,
} from '@/lib/geo-measurement'
import { deriveRawResponseLocator } from './row-mapper'
import type { GeoEvidenceRecord, GeoFrozenPlan, GeoProviderRequest } from './types'

const known = <T>(value: T): { known: true; value: T } => ({ known: true, value })

/** 从冻结计划 + 样本序号构造采集身份七项（全部 known —— cohort 是显式冻结的）。 */
export function buildAcquisitionIdentity(plan: GeoFrozenPlan, queryKey: string, sampleIndex: number): GeoAcquisitionIdentity {
  return {
    querySetVersion: known(plan.querySetVersion),
    queryKey: known(queryKey),
    engineFamily: known(plan.engineFamily),
    modelVersion: known(plan.modelVersion),
    locale: known(plan.locale),
    market: known(plan.market),
    sample: {
      samplePlan: known({ plannedCount: plan.sampleCount }),
      sampleIndex: known(sampleIndex),
      samplingParameters: plan.samplingParameters,
    },
  }
}

/** 从冻结计划构造解释身份（parserVersion / metricRulesVersion 均 known）。 */
export function buildInterpretationIdentity(plan: GeoFrozenPlan): GeoInterpretationIdentity {
  return {
    parserVersion: known(plan.parserVersion),
    metricRulesVersion: known(plan.metricRulesVersion),
  }
}

/** 构造一条 provider 请求。 */
export function buildProviderRequest(plan: GeoFrozenPlan, queryKey: string, questionText: string, sampleIndex: number): GeoProviderRequest {
  return {
    queryKey,
    questionText,
    engineFamily: plan.engineFamily,
    modelVersion: plan.modelVersion,
    locale: plan.locale,
    market: plan.market,
    sampleIndex,
    samplingParameters: plan.samplingParameters,
  }
}

export interface BuiltSuccess {
  readonly observation: GeoObservation
  /** 证据 + 它的原始响应正文 —— 正文必须一路带到落库，否则定位符没有兜底数据。 */
  readonly evidence: GeoEvidenceRecord
}

/**
 * 成功观测 + 与之一一对应的证据。
 *
 * 🔴 成功观测**必须**带 evidence（授权第 5 条）。二者在此一起构造，绝不分家 ——
 *    「成功却没证据」这种半成品状态在源头就不产生。
 *
 * 🔴 `rawResponseLocator` 用**库里 GENERATED 列的同一条表达式**生成
 *    （`db://public.geo_evidence/<id>/raw_response`），且与逐字保留的 `rawResponse`
 *    一起返回。此前用的 `memory://` 定位符没有任何兜底数据，落库后就是一个指向空气的
 *    地址 —— 「日后用新 parser 重新解析」在那种形态下根本做不到。
 */
export function buildSuccessObservation(args: {
  plan: GeoFrozenPlan
  queryKey: string
  sampleIndex: number
  batchId: string
  observationId: string
  evidenceId: string
  observedAt: string
  confidence: number
  citations: readonly GeoCitation[]
  rawResponse: string
}): BuiltSuccess {
  const observation: GeoObservation = {
    observationId: args.observationId,
    batchId: args.batchId,
    acquisition: buildAcquisitionIdentity(args.plan, args.queryKey, args.sampleIndex),
    interpretation: buildInterpretationIdentity(args.plan),
    confidence: known(args.confidence),
    observedAt: args.observedAt,
    outcome: { ok: true, evidenceId: args.evidenceId },
  }
  const evidence: GeoEvidence = {
    evidenceId: args.evidenceId,
    observationId: args.observationId,
    rawResponseLocator: known(deriveRawResponseLocator(args.evidenceId, args.rawResponse) as string),
    citations: args.citations,
  }
  return { observation, evidence: { evidence, rawResponse: known(args.rawResponse) } }
}

/**
 * 失败观测（无证据）。
 *
 * 🔴 provider 失败 / 超时 / 限流 / parser 失败一律走这里 —— `ok:false` + 机器可读
 *    `errorCode`。**不产出 evidence**（授权：失败观测不得有证据）。confidence 记显式未知。
 */
export function buildFailedObservation(args: {
  plan: GeoFrozenPlan
  queryKey: string
  sampleIndex: number
  batchId: string
  observationId: string
  observedAt: string
  errorCode: string
  errorMessage: string
}): GeoObservation {
  return {
    observationId: args.observationId,
    batchId: args.batchId,
    acquisition: buildAcquisitionIdentity(args.plan, args.queryKey, args.sampleIndex),
    interpretation: buildInterpretationIdentity(args.plan),
    confidence: { known: false, reason: 'not_applicable' },
    observedAt: args.observedAt,
    outcome: { ok: false, errorCode: args.errorCode, errorMessage: known(args.errorMessage) },
  }
}
