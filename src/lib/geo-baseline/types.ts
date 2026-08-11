/**
 * Magic Engine 2.0 · GEO Baseline 一次性接线 —— 本模块自己的形状（Issue #883 / #917 · WP04A）
 *
 * 🔴 **这一层是「把 WP04 的三个注入点接到真东西上」，不是一个通用适配框架。**
 *    一个引擎、一个 parser、一个 store、一个客户、一次人工触发。
 *    多引擎抽象 / registry / 通用 transport 层 —— 全部明确不做（Discovery §6 C 档）。
 *
 * 🔴 **不 import `@/lib/supabase`。** 数据库客户端由调用方注入（照 `src/lib/kernel/store.ts`
 *    的理由：抓着 service-role 客户端 = 进程里任何地方都能写，且授权闸没法在内存里测）。
 *
 * 🔴 **WP02 / WP03 / WP04 一个字都不改。** 三者的目录各有架构测试挡着真实 provider 与
 *    supabase 进入（`geo-measurement-runtime/__tests__/architecture.test.ts:50-69` ·
 *    `geo-measurement-store/__tests__/row-shape.test.ts:517-557`），所以接线只能落在
 *    这个第三个模块里 —— 这是结构决定的，不是风格偏好。
 */

import type { GeoMaybeUnknown } from '@/lib/geo-measurement'

// ── 原始响应信封 ─────────────────────────────────────────────────────────────

/**
 * 存进 `geo_evidence.raw_response` 的东西。
 *
 * 🔴 **为什么不是「助手回复的那段纯文本」**：WP04 的 `GeoProviderCallResult.ok` 只给
 *    `rawResponse: string` 一个口子，而引用来源（citations）在 OpenAI 那边是**跟正文
 *    平行的结构化 annotations，不在正文里**。只存正文 = 引用来源在落库那一刻就丢了，
 *    而引用类指标正是 GEO 契约 §5 的核心。
 *
 * 🔴 GEO 契约 §4.4 要求逐字保留原始响应的**理由**是「日后用新 parser 重新解析」
 *    （§6.1 第 2 条可比性判据依赖它）。新 parser 要重新解析，就必须能拿到 annotations
 *    与 usage —— 只留正文的话，那条「解析器升级不会让历史数据作废」的承诺是空的。
 *
 * ⇒ 所以逐字保留的是**整个响应载荷**，序列化成这个带版本号的信封。
 *    版本号是给未来的重新解析器用的：信封形状变了，`envelope` 就要跟着变，
 *    老行照旧能按老版本读。
 */
export interface GeoRawResponseEnvelope {
  /** 信封形状版本。变形状必须变这个值，否则老行会被新解析器读错。 */
  readonly envelope: 'geo-baseline/openai/v1'
  /** provider **回显**的模型标识 —— 不是我们请求的那个。身份核对靠它。 */
  readonly resolvedModel: string
  /** 助手回复正文，逐字。 */
  readonly text: string
  /** 结构化引用来源（URL 原样，不规范化、不去重 —— 规范化是 parser 的事）。 */
  readonly citationUrls: readonly string[]
  readonly usage: {
    readonly promptTokens: number | null
    readonly completionTokens: number | null
  }
}

// ── provider 传输层（注入以便测试，绝不在测试里发真请求）────────────────────

/** 一次出站请求真正带上的东西 —— 测试断言的就是这个对象。 */
export interface GeoOutboundRequest {
  /** 逐字来自计划的 `modelVersion`，不是 provider 自己的常量。 */
  readonly model: string
  readonly question: string
  /** locale 的落地方式：写进 system 指令（OpenAI 没有 locale 传输参数）。 */
  readonly localeDirective: string
  /** market 的落地方式：`web_search_options.user_location.approximate`。 */
  readonly userLocation: { readonly country: string; readonly timezone: string }
}

/** 传输层结果。**不做任何解释** —— 解释是 parser 的事。 */
export interface GeoTransportResult {
  readonly resolvedModel: string
  readonly text: string
  readonly citationUrls: readonly string[]
  readonly promptTokens: number | null
  readonly completionTokens: number | null
}

/**
 * 传输层抛出的错误必须**带得出**分类依据。
 *
 * 🔴 legacy runner 把 429 / 超时 / 明确错误全塌成一个 `error_message: string`
 *    （`src/lib/ai-tracker/runners/types.ts:34`）。WP04 的四态语义决定要不要自动重放、
 *    要不要停跑 —— 塌成一态就是把「未收费可安全重放」和「计费未知不许重放」当成同一件事。
 */
export interface GeoTransportError extends Error {
  /** HTTP 状态码（拿得到时）。429 ⇒ 限流；其余 ⇒ 明确错误。 */
  readonly status?: number
  /** 中断信号触发 ⇒ 超时，计费未知。 */
  readonly isAbort?: boolean
  /** 错误响应里若带 usage，如实带出来；拿不到就是 null。 */
  readonly usage?: { readonly promptTokens: number | null; readonly completionTokens: number | null }
}

export type GeoTransport = (request: GeoOutboundRequest, signal: AbortSignal) => Promise<GeoTransportResult>

// ── 自有域名归属（R10 / GEO 契约 M8）─────────────────────────────────────────

/**
 * 经核实的自有域名 / 别名清单。
 *
 * 🔴 **清单为空 ≠ 不是自有域名。** 空清单时每条引用的 `ownedDomain` 记
 *    `{known:false, reason:'not_recorded_by_source'}`，**绝不是 `false`**
 *    —— `false` 会被下游读成「核实过，不是他的」（GEO 契约 §3.4）。
 * 🔴 谁维护这份清单是登记在案的未决项 R10 / M8，本模块只消费，不推断。
 */
export interface GeoOwnedDomainPolicy {
  /** 已核实的域名与别名。空数组 = 尚未核实，不是「一个都没有」。 */
  readonly verifiedDomains: readonly string[]
  /** 这份清单是否真的经过核实。false ⇒ 一律记未知。 */
  readonly verified: boolean
}

// ── 页面归属（R4 / R2 / WP00 U2）─────────────────────────────────────────────

/**
 * 页面级引用归属。
 *
 * 🔴 v1 恒为「不可算」。Roman 页面台账 0 条，且「本轮做不做页面级归属」是登记在案的
 *    未决项 R4（Build Control Room 裁定）。
 * 🔴 **页面台账缺失时结论永远是「不可算」，绝不是 0**
 *    —— WP00 §14 第 14 条 / Roman 文档 §4.4 第 3 条冻结。报 0 会被读成
 *    「一次都没被引用」，那是一个不同的、而且是错的事实。
 */
export interface GeoOwnedPagePolicy {
  readonly computable: false
  readonly reason: string
}

// ── parser 配置 ──────────────────────────────────────────────────────────────

export interface GeoBaselineParserConfig {
  readonly ownedDomains: GeoOwnedDomainPolicy
  readonly ownedPages: GeoOwnedPagePolicy
}

// ── 查询集读取结果 ───────────────────────────────────────────────────────────

/** 从 WP03 `geo_query_sets` + `geo_queries` 冻结出来的一份查询范围。 */
export interface GeoFrozenQueryScope {
  /** `geo_batches.query_set_id` 要用的行 id（WP02 的 GeoBatch 只有 version，没有行 id）。 */
  readonly querySetId: string
  readonly querySetVersion: string
  /** 集合是否已被某个批次锁死。首次基线跑之前通常是未锁。 */
  readonly lockedAt: GeoMaybeUnknown<string>
  readonly queries: readonly { readonly queryKey: string; readonly questionText: string }[]
}
