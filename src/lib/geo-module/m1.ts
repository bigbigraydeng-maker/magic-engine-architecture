/**
 * Magic Engine 2.0 · GEO Module v1 —— `geo-module/m1/v1` 观测级解释器（Issue #879 / WP05）
 *
 * 🔴 **纯函数、确定性、保守。** 不落库、不改传入对象、不 provider 调用、不复测、
 *    不回写 #883。同样的输入必然得到同样的结论。
 *
 * 🔴 语义逐条落地 #879 冻结评论。凡是「判不准」的地方一律**向下**取：
 *    `defer` / `indeterminate` / `not_computable` 永远优先于一个可能编出来的正结论
 *    （M1 §6 末条）。这是一个刻意欠报（宁可漏，不可假阳）的 v1 判据。
 *
 * 🔴 只读 `geo_observations` / `geo_evidence` 行形状（`@/lib/geo-measurement-store/types`）。
 *    读侧租户隔离：调用方保证行属于同一租户；本模块另在 `pipeline.ts` 补一道 fail-closed 断言。
 */

import type { GeoEvidenceRow, GeoObservationRow } from '@/lib/geo-measurement-store/types'
import type { GeoCitation } from '@/lib/geo-measurement'
import type { GrowthMaybeUnknown } from '@/lib/growth'
import {
  GEO_M1_RULE_VERSION,
  type GeoDisambiguation,
  type GeoEntityMatch,
  type GeoM1ReasonCode,
  type GeoObservationInterpretation,
  type GeoQualifiedMention,
  type GeoRankStatus,
  type GeoRecommendationClass,
} from './types'

/** 解释一条观测所需的最小输入。 */
export interface GeoM1Input {
  readonly observation: GeoObservationRow
  /**
   * 与该观测一一对应的证据行。观测失败（`outcome_ok=false`）时**没有**证据行，
   * 传 `null` —— 不是补一条空的假证据（`geo_evidence` migration `UNIQUE(observation_id)`，
   * 失败观测无证据行）。
   */
  readonly evidence: GeoEvidenceRow | null
  /**
   * 权威 `brand_aliases` 注册表当前的内容。Roman 现在**为空**（M1 §1）。
   * 传空数组 = 不认任何别名；本模块绝不自己发明别名。
   */
  readonly brandAliases: readonly string[]
  /**
   * 该观测所属 query 的问句原文（来自 `geo_queries`），用于回显剔除（M1 §3 / §7 第 2 条）。
   * 拿不到就显式未知 —— 不猜。
   */
  readonly questionText: GrowthMaybeUnknown<string>
}

/** 解析置信度阈值。低于它或未知 → defer（M1 §6 末条）。注入以便测试与调参。 */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.5

// ── 文本归一（M1 §1：Unicode 归一 + case-fold + 空白折叠） ─────────────────────

/** NFC 归一 + 小写 + 空白折叠。**不做任何词干 / 模糊处理**（M1 §1 禁止模糊匹配）。 */
export function normalizeText(raw: string): string {
  return raw.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** 去掉所有非字母数字，用于「名字是否嵌在域名 / URL 里」的判断（如 `romanhu.com`）。 */
function alnumOnly(raw: string): string {
  return raw.normalize('NFC').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * 规范实体的 token 序列（M1 §1）：精确 `roman hu`，允许相邻普通标点与英文所有格。
 *
 * 🔴 用词边界 + 可选所有格构造正则，**不做模糊 / 音近 / 姓氏单独匹配**（M1 §1）。
 *    别名当前为空；一旦注册表非空，这里按**逐字**追加，不做任何变形。
 */
function buildEntityMatcher(aliases: readonly string[]): RegExp {
  const canonical = 'roman hu'
  const terms = [canonical, ...aliases.map((a) => normalizeText(a))].filter((t) => t.length > 0)
  // 转义每个 term，token 间空白折叠成单空格已由 normalizeText 做过。
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  // (?<![a-z0-9]) / (?![a-z0-9]) 是 ASCII 词边界；末尾允许 `'s` 所有格。
  return new RegExp(`(?<![a-z0-9])(?:${escaped.join('|')})(?:'s)?(?![a-z0-9])`, 'g')
}

// ── 消歧锚点（M1 §2：锁奥克兰 / NZ 地产本人） ──────────────────────────────────

/** 地域锚点。命中任一即满足「奥克兰 / NZ」一侧。 */
const GEO_ANCHORS: readonly string[] = ['auckland', 'new zealand', 'aotearoa', ' nz ']
/** 行业锚点。命中任一即满足「地产从业者」一侧。 */
const DOMAIN_ANCHORS: readonly string[] = [
  'real estate', 'realtor', 'realty', 'property', 'salesperson', 'agent', 'ray white',
]

/** 推荐极性词表（M1 §4）—— 保守：只认真正的「选择判断」动词，不认单纯正向情绪词。 */
const ENDORSE_TERMS: readonly string[] = [
  'recommend', 'i would recommend', 'we recommend', 'you should contact', 'you should reach out',
  'suggest contacting', 'go with', 'a great agent to work with', 'strong choice', 'top choice',
  'best choice', 'best option',
]
const CONDITIONAL_MARKERS: readonly string[] = [
  'if you', 'if your', 'when you', 'depending on', 'for buyers', 'for sellers',
  'provided that', 'as long as', 'only if',
]
const NEGATIVE_TERMS: readonly string[] = [
  'avoid', 'not recommend', "don't recommend", 'do not recommend', 'steer clear',
  'would not suggest', 'poor choice', 'not a good',
]

/** 显式序数词表（M1 §5）—— 只认精确序数，不认 top / leading / 列表顺序。 */
const ORDINAL_PATTERNS: readonly { readonly re: RegExp; readonly position: number }[] = [
  { re: /#\s*1\b|\bnumber one\b|\bfirst choice\b|\branked first\b/, position: 1 },
  { re: /#\s*2\b|\bnumber two\b|\bsecond choice\b|\branked second\b/, position: 2 },
  { re: /#\s*3\b|\bnumber three\b|\bthird choice\b|\branked third\b/, position: 3 },
]

const containsAny = (haystack: string, needles: readonly string[]): string[] =>
  needles.filter((n) => haystack.includes(n))

// ── 主入口 ────────────────────────────────────────────────────────────────────

/**
 * 把一条观测 + 其证据，按 `geo-module/m1/v1` 判成一条结构化解释。
 *
 * 🔴 判断顺序严格照 M1：证据闸 → 实体匹配（§1）→ 消歧（§2）→ 合格提及（§3）
 *    → 推荐（§4）→ rank（§5）。任一前置不成立，后续一律取最保守值 + 记原因码。
 */
export function interpretObservation(input: GeoM1Input): GeoObservationInterpretation {
  const { observation, evidence, brandAliases } = input
  const reasons: GeoM1ReasonCode[] = []
  const lineage = {
    batchId: observation.batch_id,
    evidenceLocator: evidenceLocatorOf(evidence),
    parserVersion: parserVersionOf(observation),
  }
  const meta = {
    ruleVersion: GEO_M1_RULE_VERSION,
    observationId: observation.id,
    lineage,
    queryKey: knownOrUnknown(observation.query_key, observation.query_key_unknown_reason),
    locale: knownOrUnknown(observation.locale, observation.locale_unknown_reason),
    market: knownOrUnknown(observation.market, observation.market_unknown_reason),
    branded: brandedOf(input),
  } as const

  // 别名注册表为空这件事永远留痕（解释为什么后面不认任何别名）。
  if (brandAliases.length === 0) reasons.push('brand_alias_registry_empty')

  // ── 证据闸（M1 §6 末条：证据缺 / 读不出 / 置信不足 → defer） ──
  const deferReason = evidenceGate(input)
  if (deferReason) {
    reasons.push(deferReason)
    return defer(meta, reasons)
  }
  // evidenceGate 过了 ⇒ evidence 非空、raw_response 非空。
  const body = normalizeText((evidence as GeoEvidenceRow).raw_response as string)
  const citations = ((evidence as GeoEvidenceRow).citations ?? []) as readonly GeoCitation[]

  // ── §1–§2 实体匹配 + 消歧 ──
  const matcher = buildEntityMatcher(brandAliases)
  const bodyEcho = stripQueryEcho(body, input.questionText)
  const entityMatch = matchEntity(body, citations, matcher, reasons)
  const disambiguation = disambiguate(entityMatch, bodyEcho, reasons)

  // ── §3 合格提及 ──
  const qualifiedMention = qualifyMention(entityMatch, disambiguation, body, bodyEcho, reasons)

  // ── §4 推荐（仅在合格提及成立时判极性；否则 none，除非歧义要 indeterminate） ──
  const recommendation = classifyRecommendation(qualifiedMention, bodyEcho, reasons)

  // ── §5 rank ──
  const rank = computeRank(qualifiedMention, bodyEcho, reasons)

  return {
    ...meta,
    disposition: 'interpreted',
    entityMatch,
    disambiguation,
    qualifiedMention,
    recommendation,
    rank,
    reasonCodes: reasons,
  }
}

// ── 证据闸 ────────────────────────────────────────────────────────────────────

function evidenceGate(input: GeoM1Input): GeoM1ReasonCode | null {
  const { observation, evidence } = input
  if (!observation.outcome_ok || evidence === null) return 'evidence_missing'
  if (typeof evidence.raw_response !== 'string' || evidence.raw_response.length === 0) {
    return 'raw_response_unreadable'
  }
  if (observation.confidence === null) return 'confidence_unknown'
  if (observation.confidence < DEFAULT_CONFIDENCE_THRESHOLD) return 'confidence_below_threshold'
  return null
}

// ── §1–§2 ────────────────────────────────────────────────────────────────────

function matchEntity(
  body: string,
  citations: readonly GeoCitation[],
  matcher: RegExp,
  reasons: GeoM1ReasonCode[],
): GeoEntityMatch {
  const spans = body.match(matcher) ?? []
  if (spans.length > 0) return { kind: 'body_match', spans }

  // 正文没有 → 看是不是只在引用（域名 / URL）里出现。owned citation ≠ mention（M1 §2）。
  const inCitation = citations.some(
    (c) => alnumOnly(c.url ?? '').includes('romanhu') || alnumOnly(c.domain ?? '').includes('romanhu'),
  )
  if (inCitation) {
    reasons.push('name_only_in_citation')
    return { kind: 'citation_only' }
  }
  reasons.push('no_name_match')
  return { kind: 'no_match' }
}

function disambiguate(
  entityMatch: GeoEntityMatch,
  bodyEcho: string,
  reasons: GeoM1ReasonCode[],
): GeoDisambiguation {
  if (entityMatch.kind !== 'body_match') {
    return { qualified: false, reason: 'disambiguation_insufficient' }
  }
  // 锚点必须在**答案正文**里（M1 §2：引用 / 标题 / URL / 问句回显都不建立身份）。
  // 用剔除回显后的正文找锚点，避免问句里的「Auckland」被当成答案上下文。
  const geo = containsAny(bodyEcho, GEO_ANCHORS)
  const domain = containsAny(bodyEcho, DOMAIN_ANCHORS)
  if (geo.length > 0 && domain.length > 0) {
    return { qualified: true, anchors: [...geo, ...domain] }
  }
  reasons.push('disambiguation_insufficient')
  return { qualified: false, reason: 'disambiguation_insufficient' }
}

// ── §3 ───────────────────────────────────────────────────────────────────────

function qualifyMention(
  entityMatch: GeoEntityMatch,
  disambiguation: GeoDisambiguation,
  body: string,
  bodyEcho: string,
  reasons: GeoM1ReasonCode[],
): GeoQualifiedMention {
  if (entityMatch.kind !== 'body_match') {
    // 原因码已在 matchEntity 记过（citation_only / no_name_match）。
    return {
      qualified: false,
      reason: entityMatch.kind === 'citation_only' ? 'name_only_in_citation' : 'no_name_match',
    }
  }
  if (!disambiguation.qualified) {
    return { qualified: false, reason: 'disambiguation_insufficient' }
  }
  // 语义参与：去掉问句逐字回显后，正文里还留着实体命中，才算真参与（M1 §3 第 3 条 / §7 第 2 条）。
  const matcher = buildEntityMatcher([])
  if (!matcher.test(bodyEcho)) {
    reasons.push('query_echo_only')
    return { qualified: false, reason: 'query_echo_only' }
  }
  const spans = body.match(buildEntityMatcher([])) ?? []
  return { qualified: true, spans }
}

// ── §4 ───────────────────────────────────────────────────────────────────────

function classifyRecommendation(
  qualifiedMention: GeoQualifiedMention,
  bodyEcho: string,
  reasons: GeoM1ReasonCode[],
): GeoRecommendationClass {
  if (!qualifiedMention.qualified) {
    // M1 §4：没有合格提及 → none（除非歧义要 indeterminate）。这里无歧义信号，落 none。
    return 'none'
  }
  const endorse = containsAny(bodyEcho, ENDORSE_TERMS).length > 0
  const negative = containsAny(bodyEcho, NEGATIVE_TERMS).length > 0
  if (endorse && negative) {
    reasons.push('recommendation_ambiguous')
    return 'indeterminate'
  }
  if (negative) return 'negative'
  if (endorse) {
    const conditional = containsAny(bodyEcho, CONDITIONAL_MARKERS).length > 0
    return conditional ? 'conditional' : 'explicit_positive'
  }
  reasons.push('no_recommendation_judgment')
  return 'none'
}

// ── §5 ───────────────────────────────────────────────────────────────────────

function computeRank(
  qualifiedMention: GeoQualifiedMention,
  bodyEcho: string,
  reasons: GeoM1ReasonCode[],
): GeoRankStatus {
  if (!qualifiedMention.qualified) return { status: 'not_applicable' }
  const hits = ORDINAL_PATTERNS.filter((p) => p.re.test(bodyEcho))
  if (hits.length === 0) {
    reasons.push('no_explicit_ordinal')
    return { status: 'not_computable', reason: 'no_explicit_ordinal' }
  }
  const positions = new Set(hits.map((h) => h.position))
  if (positions.size > 1) {
    reasons.push('ordinal_ambiguous')
    return { status: 'not_computable', reason: 'ordinal_ambiguous' }
  }
  return { status: 'computed', position: hits[0].position }
}

// ── 小工具 ────────────────────────────────────────────────────────────────────

/** 从正文里逐字剔除问句回显（M1 §7 第 2 条：问句被重复不建立身份）。 */
function stripQueryEcho(body: string, questionText: GrowthMaybeUnknown<string>): string {
  if (!questionText.known) return body
  const q = normalizeText(questionText.value)
  if (q.length === 0) return body
  return body.split(q).join(' ')
}

function defer(
  meta: Omit<GeoObservationInterpretation, 'disposition' | 'entityMatch' | 'disambiguation' | 'qualifiedMention' | 'recommendation' | 'rank' | 'reasonCodes'>,
  reasons: readonly GeoM1ReasonCode[],
): GeoObservationInterpretation {
  return {
    ...meta,
    disposition: 'defer',
    entityMatch: { kind: 'no_match' },
    disambiguation: { qualified: false, reason: 'disambiguation_insufficient' },
    qualifiedMention: { qualified: false, reason: 'no_name_match' },
    recommendation: 'none',
    rank: { status: 'not_applicable' },
    reasonCodes: reasons,
  }
}

function knownOrUnknown(
  value: string | null,
  reasonColumn: string | null,
): GrowthMaybeUnknown<string> {
  if (typeof value === 'string' && value.length > 0) return { known: true, value }
  return { known: false, reason: mapUnknownReason(reasonColumn) }
}

function evidenceLocatorOf(evidence: GeoEvidenceRow | null): GrowthMaybeUnknown<string> {
  if (evidence && typeof evidence.raw_response_locator === 'string' && evidence.raw_response_locator.length > 0) {
    return { known: true, value: evidence.raw_response_locator }
  }
  return { known: false, reason: 'not_recorded_by_source' }
}

function parserVersionOf(observation: GeoObservationRow): GrowthMaybeUnknown<string> {
  if (typeof observation.parser_version === 'string' && observation.parser_version.length > 0) {
    return { known: true, value: observation.parser_version }
  }
  return { known: false, reason: mapUnknownReason(observation.parser_version_unknown_reason) }
}

/** 问句点名规范实体 = branded（M1 §7 第 2 条）。拿不到问句 → 未知，不猜。 */
function brandedOf(input: GeoM1Input): GrowthMaybeUnknown<boolean> {
  if (!input.questionText.known) return { known: false, reason: 'not_recorded_by_source' }
  const q = normalizeText(input.questionText.value)
  return { known: true, value: buildEntityMatcher(input.brandAliases).test(q) }
}

/**
 * 把 `geo_*_unknown_reason` 列（WP02/03 的三值域）映射到 Growth 的未知理由码。
 * 两套枚举语义一一对得上，映射不上一律落 `not_recorded_by_source`（最保守）。
 */
function mapUnknownReason(column: string | null): 'not_recorded_by_source' | 'not_applicable' | 'source_ambiguous' {
  switch (column) {
    case 'not_applicable':
      return 'not_applicable'
    case 'source_ambiguous':
      return 'source_ambiguous'
    case 'not_recorded_by_source':
    default:
      return 'not_recorded_by_source'
  }
}
