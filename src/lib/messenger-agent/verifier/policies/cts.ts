/**
 * CTS Tours NZ verifier policy — the seven gates a Governed Reply Agent draft
 * must clear before a human (Ray/FDE) is even shown it for approval (Issue
 * #1579, L4 客户专属 — do not import this from anywhere that is meant to stay
 * client-agnostic; see `../framework.ts` for the generic shell this plugs into).
 *
 * ## v3 改接(design doc §9.14 C.3/C.4)—— 事实源从 offerings.yaml 换成客户知识库
 *
 * 本文件原读 `loadOfferings({ configSlug: CTS_CONFIG_SLUG })`(v2)。v3 唯一
 * 事实源改为 [`getClientKnowledge(clientId, { purpose: 'customer_reply' })`]
 * (`../../knowledge/read.ts`)。这个改动带来两处结构性变化,不是简单换个字段名:
 *
 *   1. **Gate 2(下架/未知产品提及)不再有正文可比对**——`visibility='forbidden'`
 *      的事实,读取入口在任何用途下都不返回它的 `statement`/`structuredValue`
 *      正文,只把 `fact_key` 报在 `forbiddenFactKeys[]` 里(设计意图:防止连
 *      Verifier 这一层的调试日志/人工复核界面都意外泄露"这个产品叫什么名字、
 *      为什么下架"这类不该被引用的内容)。这意味着 gate 2 无法再用"回复文本
 *      是否包含下架团的 name/alias 原文"这种字符串比对——`fact_key` 本身必须
 *      承担起"能被文本匹配识别"的角色。本文件因此为 CTS 的下架/禁提产品事实
 *      钉死一个 fact_key 命名约定(见下方 `CTS_FORBIDDEN_PRODUCT_KEY_*` 常量组),
 *      要求负责录入这类事实的人(萃取工作流 #1645 / FDE 审核页 #1646)照此
 *      命名——这是本次改动为了让 gate 2 继续工作而新引入的**跨模块契约**,
 *      design doc §9.14 C.2 原文把"别名匹配怎么做"列为明确开放问题留给实现者
 *      决定,这里就是那个决定,已知限制见该常量组注释。
 *   2. **Gate 3/5/7 需要的"在售产品"结构化数据,从 `OfferingsFile.active_tours`
 *      改成从 `entries[]` 里挑出 `sensitivity` 属于价格类的行、按同一约定解析
 *      `structuredValue`**——见 `parseActiveProductFacts`。解析失败的行按"不算
 *      一个可信在售产品"处理(不 throw、只跳过 + console.warn),这是刻意的
 *      fail-closed 方向:宁可让某条格式有问题的知识行暂时"对 Verifier 不存在"
 *      (于是任何提到它的回复都会因为 gate 3/5 找不到匹配而被挡),也不要因为
 *      结构校验失败而让整个 verifier 调用抛错、影响其它无关产品的核验。
 *
 * ## Cross-issue contract this file depends on (Issue #1580)
 *
 * The Agent's output shape is `{ reply_text, confidence, offerings: { name,
 * code }[] }` — `offerings` is a **paired** array, not two parallel arrays of
 * names and codes. The provenance gate below relies on that pairing to check
 * name↔code correspondence one entry at a time; if #1580 ships a different
 * shape, `CtsAgentOutput` here must be updated to match (and the provenance
 * gate rewritten) rather than one side silently drifting from the other.
 *
 * ## Why every gate collects, and none of them talk to the database
 *
 * All seven gates here are pure functions of `CtsVerifierContext` — the caller
 * (the reply-send pipeline) is responsible for fetching `brand_redline_phrases`
 * and calling `getClientKnowledge()` first and handing the result in. That
 * mirrors the pattern already established in `classify.ts`
 * (`PostSaleClassificationPolicy`): a policy file should be trivially testable
 * with plain objects, and the caller — not this file — owns "what do I do
 * when a DB read fails" (answer, per CLAUDE.md 铁律: fail closed, never
 * silently fall back to "no redlines" / "no canonical facts").
 */

import { containsPhrase, normalizeAngle } from '@/lib/factory/strategist'
import type { KnowledgeEntry, KnowledgeReadResult } from '@/lib/knowledge'
import type { Gate, VerifierResult } from '../framework'
import { runVerifierGates } from '../framework'

// ─── Identity guard ─────────────────────────────────────────────────────────

/**
 * CTS Tours NZ's `clients.id` (see CLAUDE.md 客户 ID 索引). This policy file is
 * CTS-specific by construction — every gate below reads CTS's own canonical
 * facts and redline phrases — so `verifyCtsReply` refuses to run any gate at
 * all when the context's `clientId` does not match this constant. Without
 * this check, a wiring bug that accidentally paired CTS's policy with another
 * client's conversation data would run CTS's brand-redline phrases and tour
 * canon against, say, a real-estate client's draft reply — passing gates that
 * mean nothing for that client's actual facts, and missing the ones that do.
 */
export const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'

// ─── Agent output contract (Issue #1580) ───────────────────────────────────

export interface CtsAgentOfferingReference {
  name: string
  code: string
}

export interface CtsAgentOutput {
  reply_text: string
  confidence: number
  offerings: CtsAgentOfferingReference[]
}

export interface CtsVerifierContext {
  /** The conversation's actual `clients.id` — must equal `CTS_CLIENT_ID`. */
  clientId: string
  agentOutput: CtsAgentOutput
  /** `clients.brand_redline_phrases` for this conversation's client. */
  brandRedlinePhrases: string[]
  /** `getClientKnowledge(CTS_CLIENT_ID, { purpose: 'customer_reply' })` result. */
  knowledge: KnowledgeReadResult
}

// ─── CTS 产品事实的 fact_key 命名约定(本文件新定义,萃取/审核流程需遵循)────

/**
 * 在售、可对客户报价/给行程链接的产品(团)—— `structuredValue` 形状见
 * `CtsActiveProductFact`。`sensitivity` 必须是 price/timeline/commitment/
 * policy 四类之一(见 `getClientKnowledge` 的双签闸门),否则这条事实永远拿不到
 * 客户确认,gate 3/5 也就永远看不到它——这不是本文件的判断,是知识库读取入口
 * 本身的设计(§9.14 A 五道闸门),这里只是提醒:price 类事实录入时对应字段
 * 也要选对 sensitivity,不是本文件能补救的。
 */
const ACTIVE_PRODUCT_KEY_PREFIX = 'tour.active.'

/**
 * 下架 / 绝不能对客户提起的产品 —— `visibility='forbidden'`,正文永远不通过
 * `getClientKnowledge` 返回,只有 `fact_key` 会出现在 `forbiddenFactKeys[]`
 * 里。约定:`tour.retired.<code>` 是产品自己的 canonical key;如果这个产品有
 * 常见别名需要单独覆盖文本匹配,额外登记一条 `tour.retired.<code>.alias.
 * <alias-slug>`(alias-slug 同样是归一化后的 kebab-case)。
 *
 * 🔴 已知限制(design doc §9.14 C.2 明确列为开放问题,这里是本次改动给出的
 * MVP 解法,不是把问题解决掉):gate 2 只能用"把整段回复文本归一化成一串
 * kebab-case 词,看这串词里有没有连续出现某个禁止 slug"这种启发式匹配(见
 * `slugify` + `retiredTourMentionGate`)。这意味着:
 *   - 客户说法跟录入的产品名/别名用词差异较大时(意译、拼错、极口语化表达)
 *     可能漏挡——这条闸不是唯一防线,gate 5(provenance)会挡住"回复在
 *     `offerings[]` 里结构化引用了一个不在活跃产品清单里的编码",两道闸合起来
 *     覆盖"提到具体产品"的两种主要形式(自由文本提及 / 结构化引用)。
 *   - 别名覆盖率取决于录入时有没有把常见说法都登记成 `.alias.` 条目,这是
 *     萃取工作流(#1645)/ FDE 审核页(#1646)的操作规范问题,不是这个函数能
 *     兜底的——上线前 dry-run(T-14d,见 v3 方案"验证计划")必须用真实历史
 *     对话验证这条闸的实际命中率,而不是假设约定被严格遵守。
 */
const RETIRED_PRODUCT_KEY_PREFIX = 'tour.retired.'
const RETIRED_PRODUCT_ALIAS_MARKER = '.alias.'

interface CtsActiveProductFact {
  factKey: string
  code: string
  name: string
  aliases: string[]
  price_nzd: number
  departure_dates: string[]
  itinerary_url: string
}

/**
 * 结构校验用最小 shape guard,不用 Zod——`structuredValue` 是 JSONB(`unknown`),
 * 这里只挑 gate 3/5/7 实际用得到的字段,其余(nights/highlights 等展示用字段)
 * 交给 `query_customer_facing_facts`(tools.ts)原样透传给 Agent,不在这里重复
 * 校验。任何一个必需字段类型不对就返回 `null`——调用方(下面的
 * `parseActiveProductFacts`)按"这行暂时不存在"处理,不 throw。
 */
function parseActiveProductFact(entry: KnowledgeEntry): CtsActiveProductFact | null {
  if (!entry.factKey.startsWith(ACTIVE_PRODUCT_KEY_PREFIX)) return null
  const v = entry.structuredValue
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>

  const code = typeof r.code === 'string' ? r.code : entry.factKey.slice(ACTIVE_PRODUCT_KEY_PREFIX.length)
  const price_nzd = typeof r.price_nzd === 'number' ? r.price_nzd : null
  const departure_dates = Array.isArray(r.departure_dates)
    ? r.departure_dates.filter((d): d is string => typeof d === 'string')
    : null
  const itinerary_url = typeof r.itinerary_url === 'string' ? r.itinerary_url : null
  if (price_nzd === null || departure_dates === null || itinerary_url === null) {
    console.warn(
      `[messenger-agent/verifier/cts] fact "${entry.factKey}" 缺少 price_nzd/departure_dates/` +
      `itinerary_url 中至少一项，本次核验按"这条产品事实不存在"处理（不 throw，不阻塞其它产品）`,
    )
    return null
  }

  const name = typeof r.name === 'string' && r.name ? r.name : entry.statement
  const aliases = Array.isArray(r.aliases) ? r.aliases.filter((a): a is string => typeof a === 'string') : []

  return { factKey: entry.factKey, code, name, aliases, price_nzd, departure_dates, itinerary_url }
}

function parseActiveProductFacts(entries: KnowledgeEntry[]): CtsActiveProductFact[] {
  const out: CtsActiveProductFact[] = []
  for (const entry of entries) {
    const parsed = parseActiveProductFact(entry)
    if (parsed) out.push(parsed)
  }
  return out
}

/** 见上方 `RETIRED_PRODUCT_KEY_PREFIX` 注释——从 forbiddenFactKeys 里挑出 CTS 产品相关的,取其归一化 slug。 */
function extractForbiddenProductSlugs(forbiddenFactKeys: string[]): string[] {
  const slugs: string[] = []
  for (const key of forbiddenFactKeys) {
    if (!key.startsWith(RETIRED_PRODUCT_KEY_PREFIX)) continue
    const rest = key.slice(RETIRED_PRODUCT_KEY_PREFIX.length)
    const aliasIdx = rest.indexOf(RETIRED_PRODUCT_ALIAS_MARKER)
    const slug = aliasIdx === -1 ? rest : rest.slice(aliasIdx + RETIRED_PRODUCT_ALIAS_MARKER.length)
    if (slug) slugs.push(slug)
  }
  return slugs
}

/** 归一化成跟 `tourCodeSchema`(已作废的 `offerings-loader.ts`)同一种 kebab-case 比对形状。 */
function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// ─── Gate 1 · Brand redline ─────────────────────────────────────────────────

/**
 * Reuses `containsPhrase` from `src/lib/factory/strategist.ts` (exported for
 * this file in the same PR — see that file's comment) so brand-redline
 * matching semantics stay identical between the Content Factory and the
 * Governed Reply Agent instead of two independently-drifting implementations
 * of "does this text contain that phrase."
 */
function brandRedlineGate(): Gate<CtsVerifierContext> {
  return {
    id: 'brand_redline',
    check(ctx) {
      const text = ctx.agentOutput.reply_text
      for (const phrase of ctx.brandRedlinePhrases) {
        if (phrase && containsPhrase(text, phrase)) {
          return `reply contains brand-redline phrase "${phrase}"`
        }
      }
      return null
    },
  }
}

// ─── Gate 2 · Retired/forbidden product mention ─────────────────────────────

/**
 * v3 改法(design doc §9.14 C.3):不再比对 `retired_tours[].name/aliases` 正文
 * (读取入口不再把这份正文交出来),改成把回复文本整体归一化成 slug 串，看
 * 里面有没有连续出现某个禁止产品的 slug。已知限制见
 * `RETIRED_PRODUCT_KEY_PREFIX` 注释。
 */
function retiredTourMentionGate(): Gate<CtsVerifierContext> {
  return {
    id: 'retired_tour_mention',
    check(ctx) {
      const forbiddenSlugs = extractForbiddenProductSlugs(ctx.knowledge.forbiddenFactKeys)
      if (forbiddenSlugs.length === 0) return null
      const replySlug = slugify(ctx.agentOutput.reply_text)
      for (const slug of forbiddenSlugs) {
        if (replySlug.includes(slug)) {
          return `reply mentions a forbidden/retired product (matched forbidden fact slug "${slug}")`
        }
      }
      return null
    },
  }
}

// ─── Gate 3 · Number claim (price / date must be verifiable) ───────────────

/**
 * MVP extraction, scoped to what the reply agent is expected to produce
 * verbatim from canonical facts: `$1,234` / `NZ$1234(.56)` style price
 * mentions, and ISO `YYYY-MM-DD` date mentions. A reply that spells a date
 * out in prose ("16 November 2026") is a known gap this gate does not catch —
 * flagged here rather than silently assumed covered; tightening this is
 * future work once the dry-run (Issue P) shows what formats the Agent
 * actually produces.
 */
const PRICE_MENTION_RE = /(?:NZ\$|\$)\s?([\d,]+(?:\.\d{1,2})?)/gi
const ISO_DATE_MENTION_RE = /\b\d{4}-\d{2}-\d{2}\b/g

function extractPriceMentions(text: string): number[] {
  const out: number[] = []
  for (const match of text.matchAll(PRICE_MENTION_RE)) {
    const n = Number(match[1].replace(/,/g, ''))
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

function extractIsoDateMentions(text: string): string[] {
  return [...text.matchAll(ISO_DATE_MENTION_RE)].map((m) => m[0])
}

function numberClaimGate(): Gate<CtsVerifierContext> {
  return {
    id: 'number_claim',
    check(ctx) {
      const activeProducts = parseActiveProductFacts(ctx.knowledge.entries)
      const validPrices = new Set(activeProducts.map((t) => t.price_nzd))
      const validDates = new Set(
        activeProducts.flatMap((t) => t.departure_dates.map((d) => d.slice(0, 10)))
      )

      const text = ctx.agentOutput.reply_text
      for (const price of extractPriceMentions(text)) {
        if (!validPrices.has(price)) {
          return `reply states price "$${price}" that does not match any confirmed active product's price`
        }
      }
      for (const date of extractIsoDateMentions(text)) {
        if (!validDates.has(date)) {
          return `reply states date "${date}" that does not match any confirmed active product's departure dates`
        }
      }
      return null
    },
  }
}

// ─── Gate 4 · Reply forbidden topics ────────────────────────────────────────

/**
 * Independent from `master_briefs.excluded_topics` (that field is a content/
 * brand-voice concern for the Content Factory) — `reply_forbidden_topics` is
 * about what the Governed Reply Agent is allowed to say at all. Per design
 * doc's "三份禁止清单分工" table this stays a CTS-policy-owned static list —
 * it does NOT live in the client knowledge base (that table is for factual
 * claims with a truth value, not "topics we decline to discuss").
 */
export const CTS_REPLY_FORBIDDEN_TOPICS: readonly string[] = [
  'Refund or compensation decisions',
  'Visa outcome guarantees',
]

function replyForbiddenTopicsGate(): Gate<CtsVerifierContext> {
  return {
    id: 'reply_forbidden_topic',
    check(ctx) {
      const text = ctx.agentOutput.reply_text
      for (const topic of CTS_REPLY_FORBIDDEN_TOPICS) {
        if (topic && containsPhrase(text, topic)) {
          return `reply touches forbidden topic "${topic}"`
        }
      }
      return null
    },
  }
}

// ─── Gate 5 · Provenance (name↔code one-to-one mapping) ────────────────────

/**
 * v3 补丁#8: this must check that each `{name, code}` pair in
 * `agentOutput.offerings` refers to the SAME active product — not merely that
 * `name` appears somewhere in the whitelist and `code` appears somewhere in
 * the whitelist independently. The attack this closes: an agent hallucinating
 * `{ name: "<a real product's name>", code: "<a different, fabricated code>" }`
 * would pass a "are these N names and N codes both in the allowed sets"
 * check, but must fail here.
 */
function provenanceGate(): Gate<CtsVerifierContext> {
  return {
    id: 'provenance',
    check(ctx) {
      const activeProducts = parseActiveProductFacts(ctx.knowledge.entries)
      for (const ref of ctx.agentOutput.offerings) {
        const normalizedRefName = normalizeAngle(ref.name)
        const matchedProduct = activeProducts.find((product) => {
          const candidateNames = [product.name, ...product.aliases]
          return candidateNames.some((name) => normalizeAngle(name) === normalizedRefName)
        })
        if (!matchedProduct) {
          return `offering name "${ref.name}" does not match any confirmed active product's name or aliases`
        }
        if (matchedProduct.code !== ref.code) {
          return `offering name "${ref.name}" resolves to product code "${matchedProduct.code}", but reply claims code "${ref.code}"`
        }
      }
      return null
    },
  }
}

// ─── Gate 6 · Length ─────────────────────────────────────────────────────────

/**
 * 1800 is the stricter of the two channels' message-length limits (Messenger
 * vs WhatsApp) — this constant intentionally stays a single shared value.
 * Do NOT "optimize" this into a per-channel threshold without re-reading the
 * v3 plan: the whole point of taking the stricter number is that a draft
 * approved once must be safe to send on either channel without re-checking,
 * and per-channel thresholds would silently reopen that gap. Real boundary
 * validation against each channel's actual limit is tracked separately
 * (Issue P dry-run), not this gate.
 */
const MAX_REPLY_LENGTH = 1800

function lengthGate(): Gate<CtsVerifierContext> {
  return {
    id: 'length',
    check(ctx) {
      const len = ctx.agentOutput.reply_text.length
      if (len > MAX_REPLY_LENGTH) {
        return `reply is ${len} characters, exceeds the ${MAX_REPLY_LENGTH}-character limit`
      }
      return null
    },
  }
}

// ─── Gate 7 · URL allowlist ──────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s)\]}>,;'"]+/gi

/** Trim trailing sentence punctuation a URL regex over-matches (e.g. "...nz.") */
function stripTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?]+$/, '')
}

function extractUrls(text: string): string[] {
  return [...text.matchAll(URL_RE)].map((m) => stripTrailingPunctuation(m[0]))
}

/**
 * Confirmed active products' `itinerary_url` hosts are allowed dynamically —
 * PM/FDE can add a new product with a new itinerary page without a code
 * change here (issue #1579 v3 补丁#5).
 */
function buildAllowedHosts(activeProducts: readonly CtsActiveProductFact[]): Set<string> {
  const hosts = new Set<string>(['ctstours.co.nz', 'immigration.govt.nz'])
  for (const product of activeProducts) {
    try {
      const host = new URL(product.itinerary_url).hostname.toLowerCase().replace(/^www\./, '')
      hosts.add(host)
    } catch {
      // itinerary_url is validated as a shape guard in parseActiveProductFact;
      // this catch only guards against a malformed value slipping through a
      // future relaxation, and simply contributes no host rather than
      // crashing the whole gate.
    }
  }
  return hosts
}

/**
 * `google.com/maps` in the spec means "Google Maps links," not "any
 * google.com URL" — a bare `google.com/search?...` link must still be
 * blocked. `maps.google.com` (the host Google Maps share links actually use)
 * is allowed on any path.
 */
function isUrlAllowed(rawUrl: string, allowedHosts: ReadonlySet<string>): boolean {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  if (host === 'maps.google.com') return true
  if (host === 'google.com') return parsed.pathname.startsWith('/maps')
  return allowedHosts.has(host)
}

function urlAllowlistGate(): Gate<CtsVerifierContext> {
  return {
    id: 'url_allowlist',
    check(ctx) {
      const allowedHosts = buildAllowedHosts(parseActiveProductFacts(ctx.knowledge.entries))
      const badUrls = extractUrls(ctx.agentOutput.reply_text).filter(
        (url) => !isUrlAllowed(url, allowedHosts)
      )
      if (badUrls.length > 0) {
        return `reply contains URL(s) outside the approved allowlist: ${badUrls.join(', ')}`
      }
      return null
    },
  }
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

export const ctsVerifierGates: ReadonlyArray<Gate<CtsVerifierContext>> = [
  brandRedlineGate(),
  retiredTourMentionGate(),
  numberClaimGate(),
  replyForbiddenTopicsGate(),
  provenanceGate(),
  lengthGate(),
  urlAllowlistGate(),
]

/**
 * Entry point the reply-send pipeline calls. Aborts before running any gate
 * when `clientId` does not match `CTS_CLIENT_ID` — see the identity-guard
 * comment above. This mismatch is reported through the same
 * `VerifierResult` shape (not a thrown error) so callers have exactly one
 * result contract to handle, but it is never a false "ok: false because a
 * gate found a problem" — the `blocked_reasons` entry names the mismatch
 * explicitly so this can't be confused with a content problem.
 */
export function verifyCtsReply(context: CtsVerifierContext): VerifierResult {
  if (context.clientId !== CTS_CLIENT_ID) {
    return {
      ok: false,
      blocked_reasons: [
        `client_id_mismatch: this policy is CTS-only (expected ${CTS_CLIENT_ID}), got "${context.clientId}"`,
      ],
      require_human_confirm: true,
    }
  }
  return runVerifierGates(ctsVerifierGates, context)
}
