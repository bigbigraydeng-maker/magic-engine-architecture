/**
 * Magic Engine 2.0 · GEO Module v1 —— 五段链端到端编排（Issue #879 / WP05）
 *
 * 纯函数、确定性、零副作用。串起：
 *   证据映射 → M1 观测级解释 → query 级聚合 → Finding → Prescription → ActionCandidate
 *   → 台账页解析 → PageOptimizationRequest（或诚实 defer）。
 *
 * 🔴 **只推理**：不落库、不复测、不 provider 调用、不授权、不进执行队列、不回写 #883。
 * 🔴 **读侧租户隔离（fail-closed）**：所有观测 / 证据 / 台账行必须属于入参 `clientId`，
 *    任一行租户不符直接抛 —— 绝不把 A 客户的证据算进 B 客户，也绝不落到别人的页上。
 */

import type { GeoEvidenceRow, GeoObservationRow } from '@/lib/geo-measurement-store/types'
import type {
  GrowthActionCandidate,
  GrowthEvidence,
  GrowthFinding,
  GrowthMaybeUnknown,
  GrowthPrescription,
} from '@/lib/growth'
import {
  validateGrowthActionCandidate,
  validateGrowthPrescription,
  validateGrowthVerificationDefinition,
} from '@/lib/growth'
import type { PageOptimizationIntent, PageOptimizationRequest } from '@/lib/page-optimization'
import { interpretObservation, validateEntityProfile } from './m1'
import { toGrowthEvidence } from './evidence'
import { buildQualifiedMentionFinding, hasVisibilityGap, summarizeCoverage } from './finding'
import { buildPrescription } from './prescription'
import { buildCandidate } from './candidate'
import { buildQualifiedMentionVerification, type BuildVerificationInput } from './verification'
import {
  buildPageOptimizationRequest,
  resolveLedgerPage,
  type GeoPageRequestReason,
  type SitePageRow,
} from './page-request'
import type { GeoCoverageSummary, GeoEntityProfile, GeoObservationInterpretation } from './types'

/** 一条观测记录：观测行 + 其证据行（失败观测为 null）+ 该 query 的问句原文。 */
export interface GeoObservationRecord {
  readonly observation: GeoObservationRow
  readonly evidence: GeoEvidenceRow | null
  readonly questionText: GrowthMaybeUnknown<string>
}

export interface GeoModulePipelineInput {
  readonly clientId: string
  readonly records: readonly GeoObservationRecord[]
  /**
   * 客户/实体级 GEO 解释语义。**必填**（fail-closed）。
   * Roman 调用方显式传 Roman profile；Magic Engine 调用方显式传 ME profile。
   * shared runtime 不做 Roman fallback —— 缺失 / 非法立即抛 `GeoEntityProfileError`。
   */
  readonly entityProfile: GeoEntityProfile
  /** 权威 brand_aliases 注册表内容（Roman 现为空）。 */
  readonly brandAliases: readonly string[]
  /** 本租户台账（`client_site_pages` 读模型）。 */
  readonly ledgerPages: readonly SitePageRow[]
  /** 要优化的目标页 + 已 grounding 的字段提案。 */
  readonly target: {
    readonly pageUrl: string
    readonly intents: readonly PageOptimizationIntent[]
  }
  readonly verification?: BuildVerificationInput
}

/** 五段链的中间产物 —— 无论成功或 defer 都尽量带全，供调用方审阅与 defer 归因。 */
export interface GeoModuleChain {
  readonly interpretations: readonly GeoObservationInterpretation[]
  readonly evidence: readonly GrowthEvidence[]
  readonly coverage: GeoCoverageSummary
  readonly finding: GrowthFinding | null
  readonly prescription: GrowthPrescription | null
  readonly candidate: GrowthActionCandidate | null
}

export type GeoModuleDeferReason = GeoPageRequestReason | 'no_evidence_for_finding'

export type GeoModuleOutcome =
  | { readonly ok: true; readonly request: PageOptimizationRequest; readonly chain: GeoModuleChain }
  | {
      readonly ok: false
      readonly disposition: 'defer'
      readonly reason: GeoModuleDeferReason
      readonly chain: GeoModuleChain
    }
  /**
   * 引擎跑完、证据充分，但**可解释覆盖已满、不存在可见度缺口** —— 这是一个正向结论
   * （「没缺口，无需处方」），不是 defer（判不准）。不产出 finding / 请求。
   */
  | { readonly ok: false; readonly disposition: 'no_gap'; readonly chain: GeoModuleChain }

/** 租户隔离读侧断言。任一行不属于 clientId 直接抛 —— fail-closed。 */
export class GeoModuleTenantError extends Error {
  readonly code = 'tenant_mismatch'
  constructor(message: string) {
    super(message)
    this.name = 'GeoModuleTenantError'
  }
}

/**
 * 出口不变量被破坏时抛 —— 表示本模块自己产出了不合契约的对象（是 bug，不是 defer）。
 *
 * 🔴 纵深防御：本模块是 Growth 契约的第一个消费方，产物在返回前再过一遍**运行时**校验器
 *    （白名单拒多余字段、cost 无上界即非法、input JSON-safety、三档判据齐全）。
 *    只靠编译期类型挡不住「多塞一个字段」「input 里混进 Date」这类 diff 里很无辜的退化。
 */
export class GeoModuleInvariantError extends Error {
  readonly code = 'invariant_violated'
  constructor(message: string) {
    super(message)
    this.name = 'GeoModuleInvariantError'
  }
}

function assertContract(result: { readonly ok: boolean; readonly reason?: string }, what: string): void {
  if (!result.ok) {
    throw new GeoModuleInvariantError(`产出的 ${what} 未过契约校验：${result.reason ?? '未知'}`)
  }
}

function assertTenant(input: GeoModulePipelineInput): void {
  const { clientId, records, ledgerPages } = input
  if (typeof clientId !== 'string' || clientId.length === 0) {
    throw new GeoModuleTenantError('clientId 不能为空 —— 无法做租户隔离')
  }
  for (const r of records) {
    if (r.observation.client_id !== clientId) {
      throw new GeoModuleTenantError(
        `观测 ${r.observation.id} 属于租户 ${r.observation.client_id}，与入参 ${clientId} 不符`,
      )
    }
    if (r.evidence !== null && r.evidence.client_id !== clientId) {
      throw new GeoModuleTenantError(
        `证据 ${r.evidence.id} 属于租户 ${r.evidence.client_id}，与入参 ${clientId} 不符`,
      )
    }
    // 🔴 证据↔观测配对校验：同租户内也不能把 A 观测的证据配到 B 观测上（否则读的是错的正文）。
    if (r.evidence !== null && r.evidence.observation_id !== r.observation.id) {
      throw new GeoModuleTenantError(
        `证据 ${r.evidence.id} 的 observation_id=${r.evidence.observation_id} 与配对观测 ${r.observation.id} 不一致`,
      )
    }
  }
  // 台账行的越租户不在这里抛（resolveLedgerPage 会按 clientId 过滤后再匹配），
  // 但空 clientId 已在上面挡掉，跨租户页永远进不了解析结果。
  void ledgerPages
}

/**
 * 端到端跑一次 GEO Module v1 推理。
 *
 * 🔴 `defer` 是一等结论：证据不足、台账解析不出、提案缺失都走 defer，
 *    绝不静默产出一条落在错页上或凭空编值的请求。
 */
export function runGeoModule(input: GeoModulePipelineInput): GeoModuleOutcome {
  // fail-closed：entityProfile 缺失 / 非法立即抛（不 fallback Roman）。
  validateEntityProfile(input.entityProfile)
  assertTenant(input)

  const interpretations = input.records.map((r) =>
    interpretObservation({
      observation: r.observation,
      evidence: r.evidence,
      entityProfile: input.entityProfile,
      brandAliases: input.brandAliases,
      questionText: r.questionText,
    }),
  )
  const evidence = input.records.map((r) => toGrowthEvidence({ observation: r.observation, evidence: r.evidence }))
  const coverage = summarizeCoverage(interpretations)
  const finding = buildQualifiedMentionFinding(coverage, evidence, input.entityProfile.canonicalDisplayName)

  if (finding === null) {
    const emptyChain: GeoModuleChain = { interpretations, evidence, coverage, finding: null, prescription: null, candidate: null }
    // no_gap 只在**有可解释样本**且它们都已覆盖时成立（正向结论）。
    // 无可解释样本（全 defer / 无 query）→ 判不准 → defer，绝不当成「没缺口」。
    if (evidence.length > 0 && coverage.interpretableQueries > 0 && !hasVisibilityGap(coverage)) {
      return { ok: false, disposition: 'no_gap', chain: emptyChain }
    }
    return { ok: false, disposition: 'defer', reason: 'no_evidence_for_finding', chain: emptyChain }
  }

  const prescription = buildPrescription(finding, input.entityProfile.canonicalDisplayName)
  const verification = buildQualifiedMentionVerification(input.verification)

  // 台账页解析（本租户内）。解析不出 → defer，但把链带全到 prescription。
  const resolution = resolveLedgerPage(input.ledgerPages, input.clientId, input.target.pageUrl)
  if (!resolution.ok) {
    return {
      ok: false,
      disposition: 'defer',
      reason: resolution.reason,
      chain: { interpretations, evidence, coverage, finding, prescription, candidate: null },
    }
  }

  const candidate = buildCandidate({ finding, targetPageUrl: resolution.url, summary: coverage, verification })

  // 出口纵深防御：产物过一遍运行时契约校验器（fail-closed，破了就是 bug）。
  assertContract(validateGrowthPrescription(prescription), 'prescription')
  assertContract(validateGrowthVerificationDefinition(verification), 'verification')
  assertContract(validateGrowthActionCandidate(candidate), 'candidate')

  const built = buildPageOptimizationRequest({
    clientId: input.clientId,
    resolvedPageUrl: resolution.url,
    intents: input.target.intents,
    verification,
  })
  const chain: GeoModuleChain = { interpretations, evidence, coverage, finding, prescription, candidate }
  if (!built.ok) {
    return { ok: false, disposition: 'defer', reason: built.reason, chain }
  }
  return { ok: true, request: built.request, chain }
}
