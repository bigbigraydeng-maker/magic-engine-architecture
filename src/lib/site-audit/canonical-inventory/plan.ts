/**
 * Magic Engine 2.0 · 台账计划的组装与复核（Issue #930 · WP05 前置）
 *
 * 🔴 这一步**不写任何东西**。它只把「发现到的原始 URL」翻译成一份可复核的清单：
 *    每条候选带 原始 URL / canonical URL / 决策 / 原因码 / 归一留痕，
 *    整份计划带 规则版本 + 确定性哈希。
 *
 * 🔴 计划刚生成时**没有一条是 accepted** —— 合规候选一律 `pending`，等人判。
 *    「发现即接受」正是 #930 要修的那件事。
 */

import { createHash } from 'crypto'
import {
  INVENTORY_PLAN_CONTRACT_VERSION,
  NORMALIZATION_RULE_VERSION,
  type CanonicalInventoryPlan,
  type CandidateDecision,
  type HostBoundary,
  type InventoryCandidate,
  type InventoryPlanCounts,
  type PlanReview,
  type RejectionReasonCode,
  type ReviewedInventoryPlan,
} from './types'
import { canonicaliseUrl, normaliseApprovedHosts } from './url-rules'

export class InventoryPlanError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'InventoryPlanError'
    this.code = code
  }
}

export interface BuildInventoryPlanInput {
  readonly clientId: string
  /** 通常来自 `clients.domain`。只记录，不参与同源判定。 */
  readonly requestedDomain: string
  /** 被显式批准的精确主机名。不推断、不补 www。 */
  readonly approvedHosts: readonly string[]
  /** 发现阶段拿到的原始 URL（复用现有 `discoverSitemapUrls`）。 */
  readonly discoveredUrls: readonly string[]
}

/**
 * 生成一份无写入的候选计划。
 *
 * 撞车处理：归一后指向同一个 canonical URL 的多条原始 URL，**按原始 URL 字典序**留第一条，
 * 其余记 `duplicate_canonical_target` 并指回留下的那条。
 * 用字典序而不是「先发现的那条」，是因为发现顺序取决于 sitemap / BFS 的偶然性，
 * 同一个站两次跑可能给出不同的主候选 —— 那样计划哈希就不稳定了。
 */
export function buildInventoryPlan(input: BuildInventoryPlanInput): CanonicalInventoryPlan {
  if (input.clientId.trim().length === 0) {
    throw new InventoryPlanError('missing_client_id', '生成计划必须带租户 client_id')
  }
  if (input.requestedDomain.trim().length === 0) {
    throw new InventoryPlanError('missing_domain', '生成计划必须带目标域名')
  }
  const approvedHosts = normaliseApprovedHosts(input.approvedHosts)
  const boundary: HostBoundary = { requestedDomain: input.requestedDomain.trim(), approvedHosts }

  const uniqueOriginals = Array.from(new Set(input.discoveredUrls.map((u) => u.trim()).filter((u) => u.length > 0)))
  uniqueOriginals.sort(compareStrings)

  const claimed = new Map<string, string>() // canonicalUrl → 留下的那条 originalUrl
  const candidates: InventoryCandidate[] = []

  for (const originalUrl of uniqueOriginals) {
    const result = canonicaliseUrl(originalUrl, boundary)
    if (!result.ok) {
      candidates.push({
        originalUrl,
        canonicalUrl: null,
        decision: 'rejected',
        reasonCodes: result.reasonCodes,
        notes: result.notes,
      })
      continue
    }
    const primary = claimed.get(result.canonicalUrl)
    if (primary !== undefined) {
      candidates.push({
        originalUrl,
        canonicalUrl: result.canonicalUrl,
        decision: 'rejected',
        reasonCodes: ['duplicate_canonical_target'],
        notes: result.notes,
        duplicateOf: primary,
      })
      continue
    }
    claimed.set(result.canonicalUrl, originalUrl)
    candidates.push({
      originalUrl,
      canonicalUrl: result.canonicalUrl,
      decision: 'pending',
      reasonCodes: [],
      notes: result.notes,
    })
  }

  return finalisePlan({ clientId: input.clientId.trim(), boundary, candidates, review: null })
}

export interface ReviewDecision {
  readonly decision: Exclude<CandidateDecision, 'pending'>
  /** 人工原因码；不给的话按决策自动补 `reviewer_rejected` / `reviewer_deferred`。 */
  readonly reasonCodes?: readonly RejectionReasonCode[]
}

export interface ApplyReviewInput {
  /** 按 **原始 URL** 索引的人工决策。 */
  readonly decisions: Readonly<Record<string, ReviewDecision>>
  readonly review: PlanReview
}

/**
 * 把人工决策盖到计划上，产出一份带签名与新哈希的复核计划。
 *
 * 🔴 规则自动拒掉的候选**不许被人改成 accepted**。畸形 URL / 未批准主机 / 撞车目标
 *    不是「见仁见智」，允许人工覆盖就等于允许绕过主机边界。
 * 🔴 复核必须覆盖到每一条 `pending` —— 漏判的会留在 `pending`，而激活闸拒收带 `pending` 的计划。
 */
export function applyReviewDecisions(
  plan: CanonicalInventoryPlan,
  input: ApplyReviewInput,
): ReviewedInventoryPlan {
  if (input.review.reviewedBy.trim().length === 0) {
    throw new InventoryPlanError('missing_reviewer', '复核必须署名 —— 「谁批的」是这份计划唯一的授权凭据')
  }
  if (input.review.reviewedAt.trim().length === 0) {
    throw new InventoryPlanError('missing_reviewed_at', '复核必须带时间戳')
  }
  const known = new Set(plan.candidates.map((c) => c.originalUrl))
  for (const url of Object.keys(input.decisions)) {
    if (!known.has(url)) {
      throw new InventoryPlanError('unknown_candidate', `复核决策指向了计划里不存在的候选：${url}`)
    }
  }

  const candidates = plan.candidates.map((candidate) => {
    const decision = input.decisions[candidate.originalUrl]
    if (decision === undefined) return candidate
    if (candidate.decision !== 'pending') {
      throw new InventoryPlanError(
        'auto_rejected_not_overridable',
        `候选 ${candidate.originalUrl} 已被规则判为 ${candidate.decision}（${candidate.reasonCodes.join(',')}），` +
          '不接受人工覆盖 —— 主机边界与 URL 规则不是可商量的项',
      )
    }
    return { ...candidate, decision: decision.decision, reasonCodes: resolveReasonCodes(decision) }
  })

  const finalised = finalisePlan({
    clientId: plan.clientId,
    boundary: plan.boundary,
    candidates,
    review: input.review,
  })
  return { ...finalised, review: input.review }
}

/**
 * 计划哈希。
 *
 * 覆盖契约版本 / 规则版本 / 租户 / 边界 / 每条候选的全部身份字段 / 复核签名。
 * 少盖任何一项，那一项就能在批准之后被悄悄改掉。
 */
export function computePlanHash(plan: Omit<CanonicalInventoryPlan, 'planHash'>): string {
  const payload = {
    contractVersion: plan.contractVersion,
    normalizationRuleVersion: plan.normalizationRuleVersion,
    clientId: plan.clientId,
    boundary: {
      requestedDomain: plan.boundary.requestedDomain,
      approvedHosts: [...plan.boundary.approvedHosts].sort(compareStrings),
    },
    candidates: plan.candidates.map((c) => ({
      originalUrl: c.originalUrl,
      canonicalUrl: c.canonicalUrl,
      decision: c.decision,
      reasonCodes: [...c.reasonCodes].sort(compareStrings),
      notes: [...c.notes].sort(compareStrings),
      duplicateOf: c.duplicateOf ?? null,
    })),
    review: plan.review === null ? null : {
      reviewedBy: plan.review.reviewedBy,
      reviewedAt: plan.review.reviewedAt,
      note: plan.review.note ?? null,
    },
  }
  return createHash('sha256').update(stableStringify(payload)).digest('hex')
}

/** 计划自带的哈希是否与内容一致（篡改检测）。 */
export function verifyPlanHash(plan: CanonicalInventoryPlan): boolean {
  const { planHash: _declared, ...rest } = plan
  return computePlanHash(rest) === plan.planHash
}

export function countCandidates(candidates: readonly InventoryCandidate[]): InventoryPlanCounts {
  return {
    discovered: candidates.length,
    pending: candidates.filter((c) => c.decision === 'pending').length,
    accepted: candidates.filter((c) => c.decision === 'accepted').length,
    rejected: candidates.filter((c) => c.decision === 'rejected').length,
    deferred: candidates.filter((c) => c.decision === 'defer').length,
  }
}

// ---------------------------------------------------------------------------
// 私有
// ---------------------------------------------------------------------------

function resolveReasonCodes(decision: ReviewDecision): readonly RejectionReasonCode[] {
  if (decision.reasonCodes !== undefined) return decision.reasonCodes
  if (decision.decision === 'rejected') return ['reviewer_rejected']
  if (decision.decision === 'defer') return ['reviewer_deferred']
  return []
}

function finalisePlan(parts: {
  clientId: string
  boundary: HostBoundary
  candidates: readonly InventoryCandidate[]
  review: PlanReview | null
}): CanonicalInventoryPlan {
  const core = {
    contractVersion: INVENTORY_PLAN_CONTRACT_VERSION,
    normalizationRuleVersion: NORMALIZATION_RULE_VERSION,
    clientId: parts.clientId,
    boundary: parts.boundary,
    candidates: parts.candidates,
    counts: countCandidates(parts.candidates),
    review: parts.review,
  }
  return { ...core, planHash: computePlanHash(core) }
}

/**
 * 稳定序列化：对象键排序。
 *
 * 🔴 没有复用 `@/lib/kernel/idempotency#canonicalJson` —— 那个模块的导出与
 *    `ActionDefinition` / `KernelError` 绑在一起，site-audit 采集层反向依赖执行内核
 *    是错的方向（授权原文：只有依赖方向仍然成立时才复用）。为几行代码引入这条依赖
 *    不划算，也会让架构守卫失效。
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => compareStrings(a, b))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
