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
import { GEO_COMPARABILITY_POLICY_V1, type GeoCitation } from '@/lib/geo-measurement'
import type { GrowthMaybeUnknown } from '@/lib/growth'
import {
  GEO_M1_RULE_VERSION,
  type GeoDisambiguation,
  type GeoEntityMatch,
  type GeoEntityProfile,
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
   * 客户/实体级 GEO 解释语义。**必填**，无 shared runtime 默认（fail-closed）。
   * Roman 调用方显式传 Roman profile；ME 调用方显式传 ME profile。
   */
  readonly entityProfile: GeoEntityProfile
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

/**
 * runtime fail-closed 校验：entityProfile 必须显式提供且四字段齐全。
 *
 * 🔴 不能只靠 TypeScript required —— js 调用方 / 动态构造 / 序列化后重建都会绕过类型
 *    检查；缺失 / 非数组 / canonicalDisplayName 空串一律抛。
 *
 * 🔴 空数组是**允许**的（客户 by-design 无认可 evidence，M1 会 honest defer）；
 *    但字段缺失 / 类型不对是 bug —— 立即抛，不静默补默认。
 */
export class GeoEntityProfileError extends Error {
  readonly code = 'entity_profile_invalid'
  constructor(message: string) {
    super(message)
    this.name = 'GeoEntityProfileError'
  }
}

export function validateEntityProfile(profile: unknown): asserts profile is GeoEntityProfile {
  if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) {
    throw new GeoEntityProfileError('entityProfile 必须是对象 —— 缺失 / null / 数组一律拒绝')
  }
  const p = profile as Record<string, unknown>
  if (typeof p.canonicalDisplayName !== 'string' || p.canonicalDisplayName.trim().length === 0) {
    throw new GeoEntityProfileError('entityProfile.canonicalDisplayName 必须是非空字符串')
  }
  for (const key of ['disambiguationAnchors', 'geoAnchorsMultiword', 'geoAnchorsShortWordBoundary'] as const) {
    const v = p[key]
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
      throw new GeoEntityProfileError(`entityProfile.${key} 必须是 string[]（允许空数组，禁止 undefined / null / 非字符串）`)
    }
  }
}

/**
 * 解析置信度阈值。低于它或未知 → defer（M1 §6 末条）。
 *
 * 🔴 **复用测量层冻结策略 `GEO_COMPARABILITY_POLICY_V1.minParserConfidence`（=0.80）**，
 *    绝不裸写 `0.5`。同一测量体系不能一边判某观测「不满足质量线」、一边用它驱动处方
 *    ——那正是 Codex #1032 P1-a 挑出的自相矛盾（geo-measurement/types.ts:277）。
 *    改一处（冻结策略升版本）这里自动跟上。
 */
export const DEFAULT_CONFIDENCE_THRESHOLD = GEO_COMPARABILITY_POLICY_V1.minParserConfidence

/**
 * 已知的 `raw_response` 信封版本。
 *
 * 🔴 provider 层 `src/lib/geo-baseline/provider.ts:242-252` 把每条 `raw_response` 存成
 *    `JSON.stringify({ envelope:'geo-baseline/openai/v1', text, citationUrls, rawPayload, ... })`。
 *    只能读**认得的**信封版本；出现未知版本一律 defer，不猜、不宽松解析。
 *    未来加新版本必须显式在此登记 + 单独适配器。
 */
export const KNOWN_ENVELOPE_VERSIONS: readonly string[] = ['geo-baseline/openai/v1']

/**
 * 从证据行的 `raw_response` 里提取真正的答案正文。
 *
 * 🔴 只信 `envelope.text`，绝不扫 `citationUrls` 或 `rawPayload`：那是 M1 §7
 *    「owned citation ≠ mention」的另一面 —— 把 citation 元数据 / rawPayload 里的
 *    `title` / URL / annotation 当作正文提及是同一个禁令的方向。
 *
 * 🔴 保守：未知 envelope 版本 / 不是对象 / JSON 损坏 / 缺 text / text 非字符串 / text 空串
 *    一律返回 `{ok:false}` → 上游落 defer `raw_response_envelope_unreadable`。
 */
export function extractAnswerBody(
  rawResponse: string,
): { readonly ok: true; readonly text: string } | { readonly ok: false } {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawResponse)
  } catch {
    return { ok: false }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false }
  const record = parsed as Record<string, unknown>
  const version = record.envelope
  if (typeof version !== 'string' || !KNOWN_ENVELOPE_VERSIONS.includes(version)) return { ok: false }
  const text = record.text
  if (typeof text !== 'string' || text.length === 0) return { ok: false }
  return { ok: true, text }
}

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
 * 规范实体的 token 序列（M1 §1）：从 `entityProfile.canonicalDisplayName` 经 `normalizeText`
 * 派生（例如 `"Roman Hu"` → `"roman hu"`、`"Magic Engine"` → `"magic engine"`），
 * 允许相邻普通标点与英文所有格。
 *
 * 🔴 用词边界 + 可选所有格构造正则，**不做模糊 / 音近 / 姓氏单独匹配**（M1 §1）。
 *    别名当前为空；一旦注册表非空，这里按**逐字**追加，不做任何变形。
 * 🔴 canonical token **不重复配置** —— 唯一来源是 `entityProfile.canonicalDisplayName`。
 */
function buildEntityMatcher(profile: GeoEntityProfile, aliases: readonly string[]): RegExp {
  const canonical = normalizeText(profile.canonicalDisplayName)
  const terms = [canonical, ...aliases.map((a) => normalizeText(a))].filter((t) => t.length > 0)
  // 转义每个 term，token 间空白折叠成单空格已由 normalizeText 做过。
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  // (?<![a-z0-9]) / (?![a-z0-9]) 是 ASCII 词边界；末尾允许 `'s` 所有格。
  return new RegExp(`(?<![a-z0-9])(?:${escaped.join('|')})(?:'s)?(?![a-z0-9])`, 'g')
}

// ── 消歧锚点（M1 §2：从 profile 读，不再硬编码） ────────────────────────────────

/**
 * 文本里是否有地域锚点，返回命中列表（供审计）。
 *
 * 🔴 多词锚点走子串命中（`.includes`）；短 token 走**词边界**（`\b<token>\b`）——
 *    否则 `nz` / `au` 之类短缩写会命中 `bonza` / `augment` 之类无关词。短 token 数组
 *    内部编译成正则，profile 只传纯字符串以保证可序列化。
 */
function geoAnchorsIn(text: string, profile: GeoEntityProfile): string[] {
  const hits = profile.geoAnchorsMultiword.filter((a) => text.includes(a))
  for (const token of profile.geoAnchorsShortWordBoundary) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`\\b${escaped}\\b`).test(text)) hits.push(token)
  }
  return hits
}

/**
 * 推荐极性词表（M1 §4）—— 保守：只认真正的「选择判断」动词，不认单纯正向情绪词。
 *
 * 🔴 显式列出 recommend 的常用屈折形（`recommends` / `recommended` / `recommending`），
 *    **不做通配后缀匹配**：加了词边界后，裸 `recommend` 不会命中 `recommendations`
 *    （名词复数，客户评价数）——那正是本次假阳的入口。别用正则通配 `recommend.*`
 *    重新把 `recommendations` 放进来。
 */
const ENDORSE_TERMS: readonly string[] = [
  'recommend', 'recommends', 'recommended', 'recommending',
  'i would recommend', 'we recommend', 'you should contact', 'you should reach out',
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

/** reason 码去重（保序）—— 多道闸可能对同一情形各记一次，审计读起来不该有重复噪声。 */
function dedupeReasons(reasons: readonly GeoM1ReasonCode[]): GeoM1ReasonCode[] {
  return Array.from(new Set(reasons))
}

/**
 * 句子级绑定（M1 §2 / §4 / §5 精度要害）。
 *
 * 🔴 消歧 / 推荐 / 序数**只能在 Roman 所在的句子里**判，不能做全文级扫描：否则
 *    「另一位奥克兰地产人在别的句子里出现」会替 Roman 完成消歧，「答案推荐的是别人」
 *    会被算成推荐 Roman（真误配风险，Codex #1032 P1）。
 *    代价是跨句代词指代（"Roman Hu is great. I recommend him."）会漏 —— 保守欠报，
 *    正是 M1 要的方向（宁可漏，不可假阳）。
 */
function splitSentences(text: string): string[] {
  // 🔴 切分必须含**从句分隔符** `; :` 与**两侧带空格的破折号** —— 真实 AI 答案常用
  //    「Roman Hu is an author; Jane Doe is the agent」这种把不同人连进一句的写法，
  //    只按 `.!?` 切会让别人的锚点 / 推荐 / 序数整句进 romanCtx，绕过句子级绑定（假阳）。
  //    破折号要求两侧空格，避免切断 `well-known` / `real-estate` 这类连字词。
  return text.split(/[.!?;:]+|\s[-–—]\s|\n+/).map((s) => s.trim()).filter((s) => s.length > 0)
}

/** 返回**含实体命中**的句子拼成的上下文（用含别名的 matcher）。没有则空串。 */
function romanContext(bodyEcho: string, matcher: RegExp): string {
  return splitSentences(bodyEcho)
    .filter((sentence) => {
      matcher.lastIndex = 0
      return matcher.test(sentence)
    })
    .join(' . ')
}

/**
 * 否定探测（§4 / §5 反读防御）。裸 `.includes()` 会把「被否定的背书 / 序数」判成正向，
 * 方向错在乐观一侧（`"I wouldn't go with Roman Hu"` 被判 explicit_positive 直接污染指标）。
 *
 * 判据：在短语出现位置**前一小段窗口**里出现否定词，就算这一处被否定。
 * 窗口取 `NEGATION_WINDOW_CHARS` 字符（约 4–5 个词），保守但足以覆盖常见反读。
 */
const NEGATION_WINDOW_CHARS = 24
const NEGATION_RE = /\b(?:not|never|no|without|hardly|avoid|dont|cannot|cant)\b|n['’]t/

function isNegatedAt(text: string, index: number): boolean {
  const start = Math.max(0, index - NEGATION_WINDOW_CHARS)
  return NEGATION_RE.test(text.slice(start, index))
}

/**
 * 短语出现处是否满足 ASCII 词边界（Codex #1032 第 5 轮 A · 假阳修）。
 *
 * 🔴 裸 `.includes('recommend')` 会命中 `recommendations`（客户评价复数）→ 抬高 explicit_positive
 *    覆盖。要求两侧都不是 `[a-z0-9]`（`_` 与非 ASCII 已被 normalizeText 抹平/隔开）。
 *    我们的短语内部允许空格、撇号等（`"i would recommend"` / `"a great agent to work with"`），
 *    只锁**外侧**边界；短语首/尾若本身以 `[a-z0-9]` 结尾/开头，词边界才生效。
 */
function isWordBoundedAt(text: string, phrase: string, idx: number): boolean {
  const start = idx
  const end = idx + phrase.length
  const isAlnum = (ch: string): boolean => /[a-z0-9]/.test(ch)
  if (phrase.length === 0) return true
  const firstChar = phrase[0]
  const lastChar = phrase[phrase.length - 1]
  const before = start > 0 ? text[start - 1] : ''
  const after = end < text.length ? text[end] : ''
  // 短语起始是 alnum：前一字符不能也是 alnum。
  if (isAlnum(firstChar) && before !== '' && isAlnum(before)) return false
  // 短语结尾是 alnum：后一字符不能也是 alnum。
  if (isAlnum(lastChar) && after !== '' && isAlnum(after)) return false
  return true
}

/** 该短语是否**至少有一处词边界内**地出现（不看否定）。 */
function containsWordBounded(text: string, phrase: string): boolean {
  let from = 0
  for (;;) {
    const idx = text.indexOf(phrase, from)
    if (idx < 0) return false
    if (isWordBoundedAt(text, phrase, idx)) return true
    from = idx + phrase.length
  }
}

/** 该短语是否**至少有一处词边界内且未被否定**地出现。 */
function hasUnnegated(text: string, phrase: string): boolean {
  let from = 0
  for (;;) {
    const idx = text.indexOf(phrase, from)
    if (idx < 0) return false
    if (isWordBoundedAt(text, phrase, idx) && !isNegatedAt(text, idx)) return true
    from = idx + phrase.length
  }
}

/** 该短语是否**至少有一处词边界内且被否定**地出现。 */
function hasNegated(text: string, phrase: string): boolean {
  let from = 0
  for (;;) {
    const idx = text.indexOf(phrase, from)
    if (idx < 0) return false
    if (isWordBoundedAt(text, phrase, idx) && isNegatedAt(text, idx)) return true
    from = idx + phrase.length
  }
}

/** 正则是否有**至少一处未被否定**的匹配（给序数用 —— 序数是正则，不是定串）。 */
function matchUnnegated(text: string, re: RegExp): boolean {
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  let m: RegExpExecArray | null
  while ((m = global.exec(text)) !== null) {
    if (!isNegatedAt(text, m.index)) return true
    if (m.index === global.lastIndex) global.lastIndex += 1 // 防零宽匹配死循环
  }
  return false
}

// ── 主入口 ────────────────────────────────────────────────────────────────────

/**
 * 把一条观测 + 其证据，按 `geo-module/m1/v1` 判成一条结构化解释。
 *
 * 🔴 判断顺序严格照 M1：证据闸 → 实体匹配（§1）→ 消歧（§2）→ 合格提及（§3）
 *    → 推荐（§4）→ rank（§5）。任一前置不成立，后续一律取最保守值 + 记原因码。
 */
export function interpretObservation(input: GeoM1Input): GeoObservationInterpretation {
  validateEntityProfile(input.entityProfile)
  const { observation, evidence, brandAliases, entityProfile } = input
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
  // 🔴 raw_response 是 provider 存的 JSON 信封（`geo-baseline/openai/v1`），**不是**答案正文。
  //    必须先按信封版本解包、只把 envelope.text 交给 normalizeText；否则 citationUrls /
  //    rawPayload 里的 URL、title、annotation 会被 body 判据误算成「正文提及」，直接违反
  //    M1 §7「owned citation ≠ mention」（Codex #1032 第 5 轮 P1 · 生产实证）。
  const extracted = extractAnswerBody((evidence as GeoEvidenceRow).raw_response as string)
  if (!extracted.ok) {
    reasons.push('raw_response_envelope_unreadable')
    return defer(meta, reasons)
  }
  const body = normalizeText(extracted.text)
  const citations = ((evidence as GeoEvidenceRow).citations ?? []) as readonly GeoCitation[]

  // ── §1 实体匹配 ──
  const matcher = buildEntityMatcher(entityProfile, brandAliases)
  // 引用命中所用的 alnum 针从规范实体 + 别名派生，**不硬编码**（换实体 / 加别名自动跟着变）。
  const citationNeedles = [entityProfile.canonicalDisplayName, ...brandAliases]
    .map(alnumOnly)
    .filter((n) => n.length > 0)
  const entityMatch = matchEntity(body, citations, matcher, citationNeedles, reasons)

  // ── 问句缺失闸（M1 §3 第 3 条）──
  // 正文里有实体命中却拿不到问句 → 无法剔除回显、无法验证语义参与 → defer，
  // 不拿「无法排除回显」当正向覆盖。（无命中的观测不受影响，正常判「未提及」。）
  if (entityMatch.kind === 'body_match' && !input.questionText.known) {
    reasons.push('question_text_unknown')
    return defer({ ...meta, entityMatch }, reasons)
  }

  // ── §2 消歧 + §4 推荐 + §5 rank 全部**绑定到实体所在句** ──
  const bodyEcho = stripQueryEcho(body, input.questionText)
  const romanCtx = romanContext(bodyEcho, buildEntityMatcher(entityProfile, brandAliases))
  const disambiguation = disambiguate(entityMatch, romanCtx, reasons, entityProfile)

  // ── §3 合格提及 ──
  const qualifiedMention = qualifyMention(entityMatch, disambiguation, body, bodyEcho, entityProfile, brandAliases, reasons)

  // ── §4 推荐（仅在合格提及成立时判极性；只看 Roman 所在句） ──
  const recommendation = classifyRecommendation(qualifiedMention, romanCtx, reasons)

  // ── §5 rank（只看 Roman 所在句） ──
  const rank = computeRank(qualifiedMention, romanCtx, reasons)

  return {
    ...meta,
    disposition: 'interpreted',
    entityMatch,
    disambiguation,
    qualifiedMention,
    recommendation,
    rank,
    reasonCodes: dedupeReasons(reasons),
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
  citationNeedles: readonly string[],
  reasons: GeoM1ReasonCode[],
): GeoEntityMatch {
  const spans = body.match(matcher) ?? []
  if (spans.length > 0) return { kind: 'body_match', spans }

  // 正文没有 → 看是不是只在引用（域名 / URL）里出现。owned citation ≠ mention（M1 §2）。
  const inCitation = citations.some((c) => {
    const hay = alnumOnly(c.url ?? '') + ' ' + alnumOnly(c.domain ?? '')
    return citationNeedles.some((n) => hay.includes(n))
  })
  if (inCitation) {
    reasons.push('name_only_in_citation')
    return { kind: 'citation_only' }
  }
  reasons.push('no_name_match')
  return { kind: 'no_match' }
}

function disambiguate(
  entityMatch: GeoEntityMatch,
  romanCtx: string,
  reasons: GeoM1ReasonCode[],
  profile: GeoEntityProfile,
): GeoDisambiguation {
  if (entityMatch.kind !== 'body_match') {
    return { qualified: false, reason: 'disambiguation_insufficient' }
  }
  // 🔴 锚点必须在**实体所在的句子**里（M1 §2：引用 / 标题 / URL / 问句回显、以及
  //    描述别人的句子都不建立实体身份）。`romanCtx` 已是「含实体命中的句子」拼成，
  //    别处的地域 / 行业词不会替实体完成消歧。
  // 🔴 门保持 `geo && domain`（M1 冻结判据不放宽）—— profile 允许空数组 = 客户显式
  //    无认可 evidence 时 100% 落 `disambiguation_insufficient`，honest defer。
  const geo = geoAnchorsIn(romanCtx, profile)
  const domain = containsAny(romanCtx, profile.disambiguationAnchors)
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
  profile: GeoEntityProfile,
  brandAliases: readonly string[],
  reasons: GeoM1ReasonCode[],
): GeoQualifiedMention {
  if (entityMatch.kind !== 'body_match') {
    // 原因码已在 matchEntity 记过（citation_only / no_name_match）。
    return {
      qualified: false,
      reason: entityMatch.kind === 'citation_only' ? 'name_only_in_citation' : 'no_name_match',
    }
  }
  // 语义参与近似（先于消歧判，以给出准确原因码）：去掉问句逐字回显后正文里还留着实体命中，
  // 才算真参与（M1 §3 第 3 条 / §7 第 2 条）。🔴 用**含别名**的 matcher，与 §1 matchEntity 同一套
  //   —— 否则别名注册表非空时，仅靠别名命中的正文提及会在这里被误判 query_echo_only。
  if (!buildEntityMatcher(profile, brandAliases).test(bodyEcho)) {
    reasons.push('query_echo_only')
    return { qualified: false, reason: 'query_echo_only' }
  }
  if (!disambiguation.qualified) {
    return { qualified: false, reason: 'disambiguation_insufficient' }
  }
  const spans = body.match(buildEntityMatcher(profile, brandAliases)) ?? []
  return { qualified: true, spans }
}

// ── §4 ───────────────────────────────────────────────────────────────────────

function classifyRecommendation(
  qualifiedMention: GeoQualifiedMention,
  ctx: string, // 🔴 Roman 所在句的上下文，不是全文（防「推荐的是别人」误配）
  reasons: GeoM1ReasonCode[],
): GeoRecommendationClass {
  if (!qualifiedMention.qualified) {
    // M1 §4：没有合格提及 → none（除非歧义要 indeterminate）。这里无歧义信号，落 none。
    return 'none'
  }
  // 正向信号 = 有一处**未被否定**的背书短语。
  const positive = ENDORSE_TERMS.some((t) => hasUnnegated(ctx, t))
  // 负向信号 = 有直接负面词，**或**某处背书被否定（「wouldn't go with」= 差评）。
  const negative =
    NEGATIVE_TERMS.some((t) => containsWordBounded(ctx, t)) || ENDORSE_TERMS.some((t) => hasNegated(ctx, t))
  if (positive && negative) {
    reasons.push('recommendation_ambiguous')
    return 'indeterminate'
  }
  if (negative) return 'negative'
  if (positive) {
    const conditional = containsAny(ctx, CONDITIONAL_MARKERS).length > 0
    return conditional ? 'conditional' : 'explicit_positive'
  }
  reasons.push('no_recommendation_judgment')
  return 'none'
}

// ── §5 ───────────────────────────────────────────────────────────────────────

function computeRank(
  qualifiedMention: GeoQualifiedMention,
  ctx: string, // 🔴 Roman 所在句的上下文，不是全文（防「序数说的是别人」误配）
  reasons: GeoM1ReasonCode[],
): GeoRankStatus {
  if (!qualifiedMention.qualified) return { status: 'not_applicable' }
  // 只认**未被否定**的显式序数（"not the first choice" 不是 rank 证据）。
  const hits = ORDINAL_PATTERNS.filter((p) => matchUnnegated(ctx, p.re))
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
  meta: Omit<GeoObservationInterpretation, 'disposition' | 'entityMatch' | 'disambiguation' | 'qualifiedMention' | 'recommendation' | 'rank' | 'reasonCodes'> &
    Partial<Pick<GeoObservationInterpretation, 'entityMatch'>>,
  reasons: readonly GeoM1ReasonCode[],
): GeoObservationInterpretation {
  const { entityMatch, ...rest } = meta
  return {
    ...rest,
    disposition: 'defer',
    // 默认 no_match；问句缺失闸会传入真实的 body_match，让审计看到「命中了但不敢判」。
    entityMatch: entityMatch ?? { kind: 'no_match' },
    disambiguation: { qualified: false, reason: 'disambiguation_insufficient' },
    qualifiedMention: { qualified: false, reason: 'no_name_match' },
    recommendation: 'none',
    rank: { status: 'not_applicable' },
    reasonCodes: dedupeReasons(reasons),
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
  return { known: true, value: buildEntityMatcher(input.entityProfile, input.brandAliases).test(q) }
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
