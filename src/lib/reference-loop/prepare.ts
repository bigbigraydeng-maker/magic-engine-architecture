/**
 * Magic Engine · Reference Loop adapter —— 五段拼装（Issue #1041 Slice 1）
 *
 * 输入：`GrowthFinding + GrowthPrescription + GrowthVerificationDefinition` +
 *      调用方已在外部读到的 snapshot / redline / providerCheck / provenance。
 * 输出：`ReferenceLoopPreparation`（可评审），或 typed 失败（`stage` + `reason`）。
 *
 * 🔴 **纯函数、确定性、零副作用**：不读表、不发网络、不写文件、不调 provider、
 *    不用 `Date.now()` / `Math.random()`。所有需要「知道时刻」的地方由调用方在
 *    `provenance.collectedAt` 里带进来。
 *
 * 🔴 **不发明并行实现**：resolve / draft / diff / validate 全部直接调用
 *    `@/lib/page-optimization` 已冻结的实现，本文件只做拼装、绑血缘、typed 失败。
 *
 * 🔴 **不硬编码任何客户 ID / 页面台账**：clientId 与 targetPageUrl 都从入参来。
 *
 * 🔴 **不合并 measurement surface**：verification.metricRef 原样透传，
 *    本层永不做 GSC / GA4 / GEO 之间的加减合并（Slice 3 的活，还没到）。
 */

import {
  PAGE_OPTIMIZATION_FIELDS,
  diffPageChange,
  draftPageChange,
  resolvePage,
  validatePageChange,
  type PageOptimizationField,
  type PageOptimizationIntent,
  type PageOptimizationRequest,
} from '@/lib/page-optimization'
import {
  validateGrowthFinding,
  validateGrowthPrescription,
  validateGrowthVerificationDefinition,
  type GrowthFinding,
  type GrowthMaybeUnknown,
  type GrowthPrescription,
} from '@/lib/growth'
import type {
  ReferenceLoopEvidenceRef,
  ReferenceLoopFailureStage,
  ReferenceLoopInput,
  ReferenceLoopPreparation,
  ReferenceLoopResult,
} from './types'

const FIELD_SET: ReadonlySet<string> = new Set(PAGE_OPTIMIZATION_FIELDS)

function fail(stage: ReferenceLoopFailureStage, reason: string): ReferenceLoopResult {
  return { ok: false, stage, reason }
}

function isSameFinding(a: GrowthFinding, b: GrowthFinding): boolean {
  // 🔴 结构等值（不是引用等值）：调用方常会重建对象再传，reference-eq 会误拒。
  //    Finding 的判定字段就是 pillar + severity + statement——三个一样即视为同一条。
  //    evidence 数组不参与相等判定：处方对同一条 finding 的证据是可以扩充的。
  return a.pillar === b.pillar && a.severity === b.severity && a.statement === b.statement
}

function extractEvidenceRefs(finding: GrowthFinding): readonly ReferenceLoopEvidenceRef[] {
  return finding.evidence.map((e) => ({
    source: e.source,
    observedAt: e.observedAt,
  }))
}

function basedOnVersionFromSnapshot(input: ReferenceLoopInput): GrowthMaybeUnknown<string> {
  const s = input.snapshot
  if (!s.ok) {
    // 🔴 快照不可用时 basedOnVersion 显式 unknown——不许沉默降级为空字符串，
    //    也不许把 provider 名当版本填。「不知道」用 GrowthMaybeUnknown 表示。
    return { known: false, reason: 'not_recorded_by_source' }
  }
  return { known: true, value: s.versionToken }
}

function buildRequest(input: ReferenceLoopInput): PageOptimizationRequest {
  const touched = new Set<PageOptimizationField>(input.intents.map((i) => i.field))
  const doNotTouch = PAGE_OPTIMIZATION_FIELDS.filter((f) => !touched.has(f))
  return {
    clientId: input.clientId,
    page: { url: input.targetPageUrl },
    intents: input.intents,
    lineage: { findingRefs: input.findingRefs },
    verification: input.verification,
    constraints: { doNotTouch },
    basedOnVersion: basedOnVersionFromSnapshot(input),
  }
}

/**
 * 五段拼装。**顺序不可变**：input → resolve → draft → diff → build request → validate。
 *
 * 语义边界写在头部注释里；这里只是把校验按 stage 拆开、每一处失败返回 typed 结果。
 */
export function prepareReferenceLoopChange(input: ReferenceLoopInput): ReferenceLoopResult {
  // ── stage: input ────────────────────────────────────────────────────────
  if (typeof input.clientId !== 'string' || input.clientId.length === 0) {
    return fail('input', 'clientId 必须是非空字符串')
  }
  if (typeof input.targetPageUrl !== 'string' || input.targetPageUrl.length === 0) {
    return fail('input', 'targetPageUrl 必须是非空字符串')
  }

  const findingCheck = validateGrowthFinding(input.finding)
  if (!findingCheck.ok) {
    return fail('input', `finding 非法：${findingCheck.reason}`)
  }
  const prescriptionCheck = validateGrowthPrescription(input.prescription)
  if (!prescriptionCheck.ok) {
    return fail('input', `prescription 非法：${prescriptionCheck.reason}`)
  }
  const verificationCheck = validateGrowthVerificationDefinition(input.verification)
  if (!verificationCheck.ok) {
    return fail('input', `verification 非法：${verificationCheck.reason}`)
  }

  const coversFinding = input.prescription.covers.some((f) => isSameFinding(f, input.finding))
  if (!coversFinding) {
    // 🔴 处方必须覆盖给定的 finding——否则拼出来的血缘对不上（把 A 的 finding 挂到
    //    B 的处方下面就等于伪造血缘）。fail-closed。
    return fail('input', 'prescription.covers 里没有这条 finding（pillar/severity/statement 一致的都算），血缘对不上')
  }

  if (input.findingRefs.length === 0) {
    return fail('input', 'findingRefs 至少一条——请求要能指回具体 Finding')
  }
  for (const ref of input.findingRefs) {
    if (typeof ref !== 'string' || ref.length === 0) {
      return fail('input', 'findingRefs 里出现空字符串或非字符串项')
    }
  }
  if (input.intents.length === 0) {
    return fail('input', 'intents 至少一条——没有字段提案就没有可起草的内容')
  }
  const seenField = new Set<string>()
  for (const intent of input.intents) {
    if (!FIELD_SET.has(intent.field)) {
      return fail('input', `intents 里字段 "${intent.field}" 不在 v1 冻结字段集合内`)
    }
    if (typeof intent.proposedValue !== 'string' || intent.proposedValue.length === 0) {
      return fail('input', `字段 "${intent.field}" 的 proposedValue 必须是非空字符串`)
    }
    if (seenField.has(intent.field)) {
      return fail('input', `字段 "${intent.field}" 出现了不止一次意图`)
    }
    seenField.add(intent.field)
  }

  // ── stage: resolve ──────────────────────────────────────────────────────
  const resolution = resolvePage({
    pageUrl: input.targetPageUrl,
    clientDomain: input.clientDomain,
    providers: input.providers,
  })
  if (!resolution.canonicalIdentity.known) {
    // 🔴 判不出规范身份——按 fail-closed 拒。此处涵盖两种情况：URL 不属于本客户域名
    //    （client/target mismatch），或 URL 本身解析不出来。**都不许猜。**
    return fail(
      'resolve',
      `无法从 targetPageUrl=${input.targetPageUrl} + clientDomain=${input.clientDomain ?? 'null'} 解出规范身份（reason=${resolution.canonicalIdentity.reason}）`,
    )
  }

  // ── stage: draft ────────────────────────────────────────────────────────
  const draft = draftPageChange(input.snapshot, input.intents)
  if (!draft.ok) {
    return fail('draft', draft.reason)
  }

  // ── stage: diff ─────────────────────────────────────────────────────────
  const diff = diffPageChange(input.snapshot, draft)
  if (!diff.ok) {
    return fail('diff', diff.reason)
  }
  // 🔴 关于「空 diff」：在 WP06 现行契约下不可达 —— draftPageChange 成功时至少
  //    产出一条字段，diffPageChange 对每条 draft 字段产出一条 change。所以本层不再
  //    单独设「空 diff 兜底」；若 WP06 未来放宽契约，这里的 typed 失败通道仍在
  //    （diff.ok 已经是判别式联合），只需要在 `if (!diff.ok)` 之后加一条断言即可。

  // ── build request（血缘 + 约束 + basedOnVersion）─────────────────────────
  const request = buildRequest(input)

  // ── stage: validate（不列在失败 stage 里；参见 types.ts 顶部注释）────────
  const validation = validatePageChange(request, diff, input.redline, input.providerCheck)

  const preparation: ReferenceLoopPreparation = {
    clientId: input.clientId,
    targetPageUrl: input.targetPageUrl,
    findingRefs: input.findingRefs,
    evidenceRefs: extractEvidenceRefs(input.finding),
    requestedChange: input.intents,
    request,
    resolution,
    snapshot: input.snapshot,
    draft,
    diff,
    validation,
    verification: input.verification,
    provenance: input.provenance,
  }
  return { ok: true, preparation }
}
