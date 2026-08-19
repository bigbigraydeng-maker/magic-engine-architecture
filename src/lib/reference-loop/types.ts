/**
 * Magic Engine · Reference Loop adapter contract —— 纯类型（Issue #1041 Slice 1）
 *
 * 这一层的职责：把 Growth Module 已经产出的 `GrowthFinding + GrowthPrescription`
 * （或调用方持有的等价上下文）串起 WP06 Page Optimization 的 `resolve → snapshot →
 * draft → diff → validate` 五段，产出一份**可评审的准备结果**——不 apply、不
 * publish、不写库、不调 provider。
 *
 * 🔴 本文件只描述形状，不做任何事——没有网络请求、没有落库、没有 provider 客户端
 *    import、没有模型调用。契约冻结见：
 *    · `docs/specs/2026-08-10-me2-wp00-contract-freeze-v1.0.md`（WP00）
 *    · `docs/specs/2026-08-10-me2-page-optimization-capability-v1.0.md`（WP06）
 *
 * 🔴 **不发明并行的 Page Optimization 实现**。resolve / draft / diff / validate
 *    一律走 `@/lib/page-optimization` 已经冻结的实现；本模块只做「拼装 + 保血缘 +
 *    typed failure」。
 *
 * 🔴 **不发明并行的 Growth 契约**。`GrowthFinding` / `GrowthPrescription` /
 *    `GrowthVerificationDefinition` / `GrowthMaybeUnknown` / `GrowthEvidence` 一律
 *    从 `@/lib/growth` 直接拿——同名不同事在这个仓库反复出事。
 *
 * 🔴 **不新增 Agent、不建平行客户 ID / 页面台账。** clientId 必须从入参来，
 *    没有 fallback、没有硬编码；页面台账（`client_site_pages`）由调用方在外部
 *    读侧完成解析后传入 `targetPageUrl`，本层不查任何表。
 *
 * 🔴 **失败一律 typed。** 顶层结果是一个判别式联合；输入非法 / resolve 认不出身份
 *    / snapshot 不可用 / draft 起草失败 / diff 定位不到 before 一律 `ok:false`
 *    带 `stage`，不吞异常伪装成功。validate 本身返回 `PageValidationResult`——
 *    验证不通过是**明确的判定**，不是 preparation 本身失败，因此仍算作 `ok:true`
 *    并把 `validation: { ok:false, ... }` 原样带回给调用方评审。
 */

import type {
  GrowthEvidence,
  GrowthFinding,
  GrowthMaybeUnknown,
  GrowthPrescription,
  GrowthVerificationDefinition,
} from '@/lib/growth'
import type {
  PageDiffResult,
  PageDraftResult,
  PageOptimizationIntent,
  PageOptimizationRequest,
  PageResolution,
  PageSnapshot,
  PageValidationResult,
  ProviderCheckInput,
  RedlineCheckInput,
  ResolvePageInput,
} from '@/lib/page-optimization'

// ── Provenance ──────────────────────────────────────────────────────────────

/**
 * 每一片输入的来源。**必填字符串**，不许省略——「不知道」也要显式记名（例如
 * `caller.explicit` / `growth_prescription` / `wp06.snapshot.github` / `redline.empty`），
 * 不要留白让下游猜。
 *
 * 🔴 `collectedAt` 是调用方提供的 ISO 时间字符串（不由本层生成）——这一层不允许
 *    读 `Date.now()`，采集时刻属于观测层的事实、由调用方带进来。
 */
export interface ReferenceLoopProvenance {
  readonly clientIdSource: string
  readonly targetPageUrlSource: string
  readonly findingSource: string
  readonly prescriptionSource: string
  readonly intentsSource: string
  readonly snapshotSource: string
  readonly redlineSource: string
  readonly providerCheckSource: string
  readonly verificationSource: string
  readonly findingRefsSource: string
  readonly collectedAt: string
  /** 观测窗口——调用方带进来；不知道就 `known:false`，不填零。 */
  readonly window: GrowthMaybeUnknown<{
    readonly startAt: string
    readonly endAt: string
  }>
}

// ── Input ───────────────────────────────────────────────────────────────────

/**
 * 一次 Reference Loop 准备的完整输入。
 *
 * 🔴 `providers` 的类型来自 `ResolvePageInput['providers']`——不直接 import
 *    `@/lib/cms/*` 类型，那属于 provider 通道；WP06 已经把它包在自己的入参形状里，
 *    我们透传即可，不需要在这层再认识 CMS 具体形状。
 */
export interface ReferenceLoopInput {
  readonly clientId: string
  readonly clientDomain: string | null
  readonly targetPageUrl: string
  readonly finding: GrowthFinding
  readonly prescription: GrowthPrescription
  /** 稳定的 finding 引用；WP06 用它填 `PageOptimizationRequest.lineage.findingRefs`。 */
  readonly findingRefs: readonly string[]
  /** 已 grounding 的字段级提案（至少一条，字段必在 v1 冻结三字段词汇内）。 */
  readonly intents: readonly PageOptimizationIntent[]
  readonly verification: GrowthVerificationDefinition
  /** WP06 `resolvePage` 需要的 provider 决策上下文，原样透传，不解释。 */
  readonly providers: ResolvePageInput['providers']
  /** 已在外部读到的页面快照（`{ok:false}` 会让 draft/diff 显式失败）。 */
  readonly snapshot: PageSnapshot
  /** 红线短语——`available:false` 让 validate fail-closed，绝不当成「没有红线」。 */
  readonly redline: RedlineCheckInput
  /** provider 侧校验——`evaluated:false` 让 validate fail-closed，绝不当成「通过」。 */
  readonly providerCheck: ProviderCheckInput
  readonly provenance: ReferenceLoopProvenance
}

// ── Preparation (successful case) ───────────────────────────────────────────

/**
 * 从 `GrowthEvidence` 抽出的引用——**只保留 source + 观测时间**，
 * 不复制原始 payload。用来在准备结果里回指证据，不重复携带证据全文。
 */
export interface ReferenceLoopEvidenceRef {
  readonly source: GrowthEvidence['source']
  readonly observedAt: string
}

/**
 * 授权准备度——由 adapter 从 `validation.ok` 直接派生，**调用方不可注入**。
 *
 * 🔴 语义严格如下（Build Control 2026-08-19 木桶闭环）：
 *    · `validation_passed` = 五段准备完成且验证判定通过；**仅允许**将
 *      `preparation.request` 提交给下一环授权评估（Kernel）。**不代表已授权，
 *      不代表 apply/publish 被允许。**
 *    · `validation_failed` = 五段准备完成但验证判定失败；只允许作为 review
 *      artifact 展示与解释，**不许进入授权候选队列**。
 *
 * 🔴 加这个字段不是为了替 Kernel 做决定，而是把「validation 判定」与「结果本身
 *    ok:true」在类型面上明确区分开，防止下游只看 `result.ok` 就把 request 塞给
 *    Kernel。Kernel 无论如何仍会依 WP07 政策二次校验，本字段是上游拦截。
 */
export type ReferenceLoopAuthorizationReadiness = 'validation_passed' | 'validation_failed'

/**
 * 可评审的准备结果——完整血缘 + 五段中间产物 + 验证定义 + provenance +
 * 由 adapter 派生的授权准备度。
 *
 * 🔴 **本对象不携带任何授权字段**（`approved` / `authorized` / `actionKey` /
 *    `risk` / `sideEffect` / `policy`）。授权只能由 Kernel 依客户政策签发；
 *    这里只产出**候选**（WP00 §5.4）。`authorizationReadiness` 只表示是否
 *    「可以进入下一环授权评估」，不是授权本身。
 */
export interface ReferenceLoopPreparation {
  readonly clientId: string
  readonly targetPageUrl: string
  readonly findingRefs: readonly string[]
  readonly evidenceRefs: readonly ReferenceLoopEvidenceRef[]
  readonly requestedChange: readonly PageOptimizationIntent[]
  readonly request: PageOptimizationRequest
  readonly resolution: PageResolution
  readonly snapshot: PageSnapshot
  readonly draft: PageDraftResult
  readonly diff: PageDiffResult
  readonly validation: PageValidationResult
  readonly verification: GrowthVerificationDefinition
  readonly provenance: ReferenceLoopProvenance
  /** 由 adapter 从 `validation.ok` 派生；不接受调用方注入。 */
  readonly authorizationReadiness: ReferenceLoopAuthorizationReadiness
}

// ── Result (discriminated union) ────────────────────────────────────────────

/** 失败发生在哪一段——`input` 覆盖调用方输入不合法，其余三段与 WP06 五段对齐。 */
export type ReferenceLoopFailureStage = 'input' | 'resolve' | 'draft' | 'diff'

/**
 * 稳定的 machine-readable 失败码——**只覆盖当前实际产生失败的分支**，
 * 不预测未来错误类别。下游按 `code` 分派 UI/retry 逻辑，不许解析中文 `reason`。
 *
 * 🔴 加新分支时同步加 code；删分支时同步删 code。code 是稳定 API 的一部分，
 *    重命名等同破坏契约（同 WP00 §8.3 第 5 条）。
 */
export type ReferenceLoopFailureCode =
  // stage = 'input'
  | 'client_id_empty'
  | 'target_page_url_empty'
  | 'finding_invalid'
  | 'prescription_invalid'
  | 'verification_invalid'
  | 'prescription_lineage_mismatch'
  | 'finding_refs_empty'
  | 'finding_refs_contains_invalid'
  | 'intents_empty'
  | 'intents_field_out_of_vocab'
  | 'intents_proposed_value_invalid'
  | 'intents_duplicate_field'
  // stage = 'resolve'
  | 'canonical_identity_unknown'
  // stage = 'draft'
  | 'draft_failed'
  // stage = 'diff'
  | 'diff_failed'

/**
 * 顶层结果。
 *
 * 🔴 **注意 `validate` 不在 `ReferenceLoopFailureStage` 里**：validate 本身
 *    产出的是一个判定（`PageValidationResult`），无论通过与否都被原样带回；
 *    preparation 本身不因 validate 判失败就变成 `ok:false`。这样调用方能同时
 *    拿到「准备做完了」和「不许 apply 的判定 + 违规清单」，用于评审与解释。
 *    参见 `preparation.authorizationReadiness` —— 判定通过与否在那里表达。
 *
 * 🔴 失败分支必带 `code`（机读稳定）+ `reason`（人读，可本地化，**不作为 API**）。
 */
export type ReferenceLoopResult =
  | { readonly ok: true; readonly preparation: ReferenceLoopPreparation }
  | {
      readonly ok: false
      readonly stage: ReferenceLoopFailureStage
      readonly code: ReferenceLoopFailureCode
      readonly reason: string
    }
