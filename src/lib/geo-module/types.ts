/**
 * Magic Engine 2.0 · GEO Module v1 —— 纯类型（Issue #879 / WP05）
 *
 * 🔴 **这个文件只描述形状，不做任何事。** 没有 provider 调用、没有落库、没有授权、
 *    没有页面写入、没有 GEO 复测。GEO Module 是 Growth 五段契约（WP01）的**第一个消费方**：
 *    它把 #883 的原始 GEO 证据（`geo_observations` + `geo_evidence`），经 #879 冻结的
 *    `geo-module/m1/v1` 语义，读成 `GrowthEvidence → GrowthFinding → GrowthPrescription
 *    → GrowthActionCandidate`，最终映射成一条 `PageOptimizationRequest`（或诚实 defer）。
 *
 * 🔴 M1 语义逐条来自 #879 评论
 *    `WP05 CONTROL DECISION — geo-module/m1/v1 semantics frozen`（2026-08-12）。
 *    **不发明、不放宽、不模糊匹配。** 证据不足一律 defer / indeterminate，绝不静默转 0 / false。
 */

import type { GrowthMaybeUnknown } from '@/lib/growth'

/** M1 规则身份。每一条观测级解释都必须原样带上它（M1 §6）。 */
export const GEO_M1_RULE_VERSION = 'geo-module/m1/v1'
export type GeoM1RuleVersion = typeof GEO_M1_RULE_VERSION

/** 规范实体（M1 §1）。别名注册表当前**为空**，v1 不许推断任何别名。 */
export const GEO_CANONICAL_ENTITY = 'Roman Hu'

/**
 * 机器可读的原因码 —— 为什么某一步落成了 none / indeterminate / not_applicable /
 * not_computable / defer（M1 §6 末条）。
 *
 * 🔴 只用枚举，不用自由文本：审计要能按原因分组统计（照 canonical-inventory 的
 *    `RejectionReasonCode`）。
 */
export type GeoM1ReasonCode =
  /** 答案正文里没有规范实体的精确 token 序列（M1 §1）。 */
  | 'no_name_match'
  /** 名字只出现在引用 / 来源元数据里，正文没有（M1 §2 / §3 第 2 条）。 */
  | 'name_only_in_citation'
  /** 名字对上了，但上下文不足以锁定奥克兰 / NZ 地产本人（M1 §2）。 */
  | 'disambiguation_insufficient'
  /**
   * 正文里的出现只是把问题原文回显，去掉回显后就没了（M1 §3 第 3 条 / §7 第 2 条）。
   *
   * 🔴 v1 对「语义参与」（M1 §3 第 3 条：Roman 作为相关人 / 候选 / 主体 / 选项参与）
   *    只做**近似**：正文精确命中 + 奥克兰/NZ 地产锚点消歧 + 剔除问句逐字回显后仍留着命中。
   *    v1 不判语法角色，因此**故意不设** `no_semantic_participation` 原因码 —— 声明一个永不
   *    push 的空闸门比没有更误导（「声明了≠接上了」）。角色级判据留待后续版本。
   */
  | 'query_echo_only'
  /** 提及了但没有任何推荐判断（M1 §4 `none`）。 */
  | 'no_recommendation_judgment'
  /** 推荐极性 / 归属 / 力度无法安全判定（M1 §4 `indeterminate`）。 */
  | 'recommendation_ambiguous'
  /** 没有显式的精确序数（M1 §5 `not_computable`）。 */
  | 'no_explicit_ordinal'
  /** 序数证据相互冲突（M1 §5 `not_computable` + ambiguity reason）。 */
  | 'ordinal_ambiguous'
  /** 观测失败（`outcome_ok=false`）→ 没有证据行（M1 §6 末条：证据不足 → defer）。 */
  | 'evidence_missing'
  /** 原始响应记为未知，读不出正文（M1 §6 末条）。 */
  | 'raw_response_unreadable'
  /** 解析置信度未知 —— 无法为这次解释背书（M1 §6 末条）。 */
  | 'confidence_unknown'
  /** 解析置信度低于阈值（M1 §6 末条）。 */
  | 'confidence_below_threshold'
  /**
   * 问句原文未知（未读到 / 来源冲突）→ 无法剔除回显、无法验证语义参与（M1 §3 第 3 条）。
   * 正文里有实体命中却拿不到问句时，「无法排除回显」不得当成正向覆盖 —— 一律 defer。
   */
  | 'question_text_unknown'
  /**
   * `raw_response` 解不出 `geo-baseline/openai/v1` 信封（第 5 轮 Codex P1）。
   *
   * 🔴 provider 存的是 `JSON.stringify(GeoRawResponseEnvelope)`，含 `text`（真答案正文）
   *    + `citationUrls` + `rawPayload`（完整 OpenAI 原始返回）。若把整段 JSON 当正文扫，
   *    citation 元数据 / rawPayload 里的 title / URL 里的实体名会被误算成「答案正文提及」
   *    ——这**恰恰是 M1 §7 明令禁止**的方向（把 citation 当 mention）。因此：
   *    信封版本不匹配 / JSON 损坏 / `envelope.text` 为空或 null → 一律 defer，不猜。
   */
  | 'raw_response_envelope_unreadable'
  /** 别名注册表为空：解释为什么不认任何别名 / 队名 / 姓氏 / 域名（M1 §1）。 */
  | 'brand_alias_registry_empty'

// ── 观测级解释（M1 §6 结构化审计输出） ─────────────────────────────────────────

/** 实体名匹配结果（M1 §1–§2）。 */
export type GeoEntityMatch =
  /** 在答案正文里精确命中。`spans` 逐字保留支撑片段（M1 §6）。 */
  | { readonly kind: 'body_match'; readonly spans: readonly string[] }
  /** 只在引用来源（URL / 域名）里出现 —— 不建立正文提及（M1 §2 / §3 第 2 条）。 */
  | { readonly kind: 'citation_only' }
  /** 正文与引用都没有精确命中。 */
  | { readonly kind: 'no_match' }

/** 消歧结果（M1 §2）。 */
export type GeoDisambiguation =
  | { readonly qualified: true; readonly anchors: readonly string[] }
  | { readonly qualified: false; readonly reason: GeoM1ReasonCode }

/** 合格提及结果（M1 §3）。 */
export type GeoQualifiedMention =
  | { readonly qualified: true; readonly spans: readonly string[] }
  | { readonly qualified: false; readonly reason: GeoM1ReasonCode }

/** 推荐分级（M1 §4）。只有 `explicit_positive` 进 v1 推荐指标。 */
export type GeoRecommendationClass =
  | 'none'
  | 'explicit_positive'
  | 'conditional'
  | 'negative'
  | 'indeterminate'

/** rank 状态（M1 §5）。只有显式且无歧义的精确序数才 `computed`。 */
export type GeoRankStatus =
  | { readonly status: 'not_applicable' }
  | { readonly status: 'not_computable'; readonly reason: GeoM1ReasonCode }
  | { readonly status: 'computed'; readonly position: number }

/**
 * 一条观测级解释（M1 §6：每条解释必须留全下面这些）。
 *
 * 🔴 `disposition='defer'` 是一等结论 —— 证据缺 / 读不出 / 不足时用它，
 *    绝不静默把 mention 判成 false、把 recommendation 判成 0（M1 §6 末条）。
 */
export interface GeoObservationInterpretation {
  readonly ruleVersion: GeoM1RuleVersion
  readonly observationId: string
  /** 血缘：指回 #883 的批次 / 证据定位 / 解析身份（M1 §6）。不回写、不改动原证据。 */
  readonly lineage: {
    readonly batchId: string
    readonly evidenceLocator: GrowthMaybeUnknown<string>
    readonly parserVersion: GrowthMaybeUnknown<string>
  }
  /** `interpreted` = 证据够、按规则判了；`defer` = 证据不足，不硬判。 */
  readonly disposition: 'interpreted' | 'defer'
  readonly entityMatch: GeoEntityMatch
  readonly disambiguation: GeoDisambiguation
  readonly qualifiedMention: GeoQualifiedMention
  readonly recommendation: GeoRecommendationClass
  readonly rank: GeoRankStatus
  readonly reasonCodes: readonly GeoM1ReasonCode[]

  // ── 聚合护栏所需的 query 级上下文（M1 §7）。全部 unknown-safe，不猜 ──
  readonly queryKey: GrowthMaybeUnknown<string>
  readonly locale: GrowthMaybeUnknown<string>
  readonly market: GrowthMaybeUnknown<string>
  /** 品牌 / 通用问句要可分（M1 §7 第 2 条）。问句点名规范实体 = branded。 */
  readonly branded: GrowthMaybeUnknown<boolean>
}

// ── query 级聚合（M1 §7：query 级先于聚合） ─────────────────────────────────────

/**
 * 一个 query 的聚合结论。
 *
 * 🔴 一个 query 对合格提及**至多计一次**（M1 §3 末段），即使 Roman 在多条样本里都出现。
 */
export interface GeoQueryOutcome {
  readonly queryKey: GrowthMaybeUnknown<string>
  readonly locale: GrowthMaybeUnknown<string>
  readonly market: GrowthMaybeUnknown<string>
  readonly branded: GrowthMaybeUnknown<boolean>
  /** 该 query 有没有一条合格提及。 */
  readonly hasQualifiedMention: boolean
  /** 该 query 有没有一条 `explicit_positive` 推荐（M1 §4：只有它进指标）。 */
  readonly hasExplicitPositive: boolean
  /** 该 query 有没有一条 `conditional` 推荐（M1 §4：必须单独报）。 */
  readonly hasConditional: boolean
  /** 该 query 的样本里被判 defer 的条数 —— 覆盖率永远配它一起读。 */
  readonly observationCount: number
  readonly deferredCount: number
}

/**
 * 一次诊断的聚合覆盖账（M1 §7 护栏）。
 *
 * 🔴 **绝不把「12/12 带引用」重述成提及 / 推荐覆盖**（M1 §7 第 5 条）。这里根本没有
 *    citation 覆盖字段 —— 引用覆盖属于测量层的另一个指标，不在本聚合里出现。
 */
export interface GeoCoverageSummary {
  readonly ruleVersion: GeoM1RuleVersion
  /** 参与聚合的 query 总数（含完全 defer 的）。 */
  readonly queryCount: number
  /**
   * **可解释** query 数 = queryCount − 完全 defer 的 query。
   *
   * 🔴 覆盖率分母只能用这个，不能用 `queryCount`：完全 defer 的 query 是「判不准」不是
   *    「未提及」，混进分母会仅因数据缺失就抬高严重度、驱动错误处方（Codex #1032 P1）。
   */
  readonly interpretableQueries: number
  /** 有合格提及的 query 数。 */
  readonly qualifiedMentionQueries: number
  /** 有 `explicit_positive` 的 query 数（v1 推荐指标）。 */
  readonly explicitPositiveQueries: number
  /** 有 `conditional` 的 query 数（单独报，不并进推荐指标）。 */
  readonly conditionalQueries: number
  /** 完全由 defer 观测构成、无法给出提及结论的 query 数。 */
  readonly fullyDeferredQueries: number
  /** 逐 query 结论，保留 locale / branded，供不混池地复核（M1 §7 第 2 / 4 条）。 */
  readonly perQuery: readonly GeoQueryOutcome[]
}
