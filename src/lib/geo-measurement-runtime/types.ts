/**
 * Magic Engine 2.0 · GEO Measurement Runtime —— 运行时类型（Issue #874 / WP04）
 *
 * 🔴 **这一层负责「跑一批测量」，但本文件只描述形状。** 真正的编排在 `runtime.ts`。
 *    运行链路被 Build Control Room 冻结为：
 *      explicit frozen plan → budget preflight → bounded fake-provider execution
 *      → WP02 validation → atomic fake-store persistence → honest completed/partial/failed。
 *
 * 🔴 **只依赖 WP02 契约层（`@/lib/geo-measurement`）。** 不 import Kernel / 执行内核 /
 *    supabase / 任何真实 provider 通道 —— 架构测试盯着这条边界。provider 与 store 都是
 *    **注入的接口**，v1 只提供假实现（fake provider + in-memory store），绝不接生产路径。
 *
 * 🔴 **不新增 schema、不改 migration。** 批次停止原因用观测的 `errorCode` + 本文件的
 *    运行时 summary/result 对象表达（Build Control Room 2026-08-11 WP04 授权裁定第 6 条）。
 */

import type {
  GeoCitation,
  GeoComparabilityCohortInput,
  GeoCoverageDescriptor,
  GeoJsonValue,
  GeoMaybeUnknown,
} from '@/lib/geo-measurement'

// ── 冻结的批次计划（一个 batch = 一个明确 cohort）────────────────────────────

/**
 * 计划里的一个问题。查询范围必须显式给出，不从任何默认样本计划里推。
 * `questionText` 冻结自已锁定的查询集（WP03 `geo_queries.question_text`）。
 */
export interface GeoPlannedQuery {
  readonly queryKey: string
  readonly questionText: string
}

/**
 * 一次运行的**显式冻结计划** = 一个 cohort。
 *
 * 🔴 授权第 2 条：query scope / provider(engine) / model / locale / market / sample count
 *    **必须逐项显式提供**，没有隐藏的 sample-plan 默认值。任一 cohort 维度缺失，
 *    在任何 provider 调用之前 **fail closed**（见 `plan.ts`）。
 *
 * 🔴 授权第 3 条：一个 batch 只代表一个明确 cohort，且有**确定的 planned-observation 上限**
 *    = `queries.length × sampleCount`。超上限 / 无界的计划必须被拒（见 `plan.ts`）。
 */
export interface GeoFrozenPlan {
  readonly clientId: string
  readonly querySetId: string
  readonly querySetVersion: string
  /** 查询范围：显式、非空。planned-observation 上限的一个因子。 */
  readonly queries: readonly GeoPlannedQuery[]
  readonly engineFamily: string
  readonly modelVersion: string
  readonly locale: string
  readonly market: string
  /** 样本数 / 样本计划的 plannedCount。显式、正整数，无默认值。 */
  readonly sampleCount: number
  /** 影响输出的采样参数（温度 / 种子等）。可控且可得时才记，拿不到就是显式未知。 */
  readonly samplingParameters: GeoMaybeUnknown<{ readonly [key: string]: GeoJsonValue }>
  readonly parserVersion: string
  readonly metricRulesVersion: string
  /** 整批授权额度（USD 硬上限）。 */
  readonly budgetUsd: number
  /** 每次可能收费的调用的**成本上界**。说不出上界的付费步骤一律 fail closed。 */
  readonly perObservationCostCeilingUsd: number
  /** 单条观测的**有界**重试次数上限（含首次尝试）。防止无界重放。 */
  readonly maxAttemptsPerObservation: number
  readonly triggeredBy: GeoMaybeUnknown<string>
}

// ── provider 抽象（v1 只有假实现）───────────────────────────────────────────

/**
 * provider 是否支持可靠幂等键。
 *
 * 🔴 授权第 4 条：**内部幂等不得被称为 provider exactly-once。** 这个字段描述的是
 *    provider 自己是否保证「同一请求不重复收费」。timeout / 网络歧义下，只有
 *    `supported` 才允许自动重放；`unsupported` / `not_applicable` 一律不自动重放，
 *    记诚实失败，留待显式重试。
 */
export type GeoProviderIdempotency = 'supported' | 'unsupported' | 'not_applicable'

/** 一次 provider 调用的输入（单条观测维度）。 */
export interface GeoProviderRequest {
  readonly queryKey: string
  readonly questionText: string
  readonly engineFamily: string
  readonly modelVersion: string
  readonly locale: string
  readonly market: string
  readonly sampleIndex: number
  readonly samplingParameters: GeoMaybeUnknown<{ readonly [key: string]: GeoJsonValue }>
}

/**
 * 一次 provider 调用的结果。
 *
 * 🔴 provider 只返回**原始响应 + 成本**，解释（置信度 / 引用来源）交给 `GeoParser`
 *    —— 对应 WP02 的采集身份 vs 解释身份分离（§3.1 / §3.3）。
 * 🔴 失败必须显式区分四种，绝不静默成功：
 *    · `error`        —— provider 明确返回错误（已收费，确定失败，不重放）
 *    · `rate_limited` —— 被限流（未收费，重放安全，可在预算允许时重试）
 *    · `timeout`      —— 超时 / 网络歧义（**是否已收费未知**，成本记为 GeoMaybeUnknown）
 */
export type GeoProviderCallResult =
  | { readonly kind: 'ok'; readonly rawResponse: string; readonly costUsd: number }
  | { readonly kind: 'error'; readonly errorCode: string; readonly message: string; readonly costUsd: number }
  | { readonly kind: 'rate_limited'; readonly message: string }
  | { readonly kind: 'timeout'; readonly message: string; readonly costUsd: GeoMaybeUnknown<number> }

export interface GeoProvider {
  readonly engineFamily: string
  readonly idempotency: GeoProviderIdempotency
  call(request: GeoProviderRequest): Promise<GeoProviderCallResult>
}

// ── parser 抽象（解释身份）──────────────────────────────────────────────────

/**
 * 把原始响应读成结构。解析失败 = 拿到了响应但读不懂 —— 观测计失败，**已花的钱不退**，
 * **不产出 evidence**。绝不因为想让批次好看就把 parser 失败改判成功。
 */
export type GeoParseResult =
  | { readonly ok: true; readonly confidence: number; readonly citations: readonly GeoCitation[] }
  | { readonly ok: false; readonly errorCode: string; readonly message: string }

export type GeoParser = (rawResponse: string, request: GeoProviderRequest) => GeoParseResult

// ── 原子持久化边界（v1 只有 in-memory 假实现）───────────────────────────────

import type { GeoBatch, GeoObservation, GeoEvidence } from '@/lib/geo-measurement'

/**
 * 一次批次落库的输入。
 *
 * 🔴 授权第 5 条：成功 observation + evidence 必须走**能拿到的最窄原子边界**。
 *    这里把「批次 + 全部观测 + 全部证据」作为一个不可分割的单元交给 store，
 *    store 要么整批写入、要么一行都不写（见 `fake-store.ts` 对 WP03 不变式的建模）。
 */
export interface GeoBatchPersistInput {
  /** 每条 WP03 行都带 client_id；持久化边界一并携带，租户不靠 batch 反查。 */
  readonly clientId: string
  readonly batch: GeoBatch
  readonly observations: readonly GeoObservation[]
  readonly evidence: readonly GeoEvidence[]
}

export interface GeoRuntimeStore {
  /** 原子写入一整批。违反任何被建模的 WP03 不变式则抛错且**什么都不写**。 */
  persistBatch(input: GeoBatchPersistInput): Promise<void>
  /** 只读：某客户已落库的全部批次（供重复运行 / 对账检查）。 */
  listBatchIds(clientId: string): Promise<readonly string[]>
}

// ── 运行时终态与停止原因（不落库，纯 result 对象）──────────────────────────

/**
 * 批次停止原因。
 *
 * 🔴 授权第 6 条：不新增 batch 级 schema 字段。停止原因由**观测的 errorCode**
 *    （逐行、已落库）+ 这个运行时 summary 对象（不落库）共同表达。
 */
export interface GeoStopReason {
  readonly code:
    | 'plan_completed'
    | 'budget_exhausted_before_first_call'
    | 'budget_exhausted_mid_run'
    | 'all_attempts_failed'
    | 'partial_failures'
  readonly detail: string
  /** 本批次实际出现过的、去重后的观测 errorCode（对账 / 人类可读摘要用）。 */
  readonly observedErrorCodes: readonly string[]
}

/** 一次运行的诚实终态。 */
export interface GeoRuntimeResult {
  readonly status: GeoBatch['status']
  readonly batchId: string
  readonly persisted: boolean
  readonly plannedCoverage: GeoCoverageDescriptor
  readonly actualCoverage: GeoCoverageDescriptor
  /** 已知总花费；出现 timeout 计费歧义时为显式未知。 */
  readonly costUsd: GeoMaybeUnknown<number>
  readonly stopReason: GeoStopReason
  /**
   * 交给 WP02 `evaluateGeoComparability` 的 cohort 输入，**每条成功观测一份**（观测粒度
   * 才有真实的 sampleIndex 身份）—— WP04 **不自己判**能不能比，只把够格的字段如实备好
   * （授权第 7 条）。没有成功观测时为空数组（没有可比的东西 = 诚实的空）。
   */
  readonly comparabilityInputs: readonly GeoComparabilityCohortInput[]
}

// ── 注入依赖（时钟 / id 工厂可注入以保证测试确定性）──────────────────────────

export interface GeoRuntimeDeps {
  readonly provider: GeoProvider
  readonly parse: GeoParser
  readonly store: GeoRuntimeStore
  /** 返回 ISO 时间戳。注入以便测试确定性。 */
  readonly now: () => string
  /** 生成稳定 id（batch / observation / evidence）。注入以便测试确定性。 */
  readonly newId: (kind: 'batch' | 'observation' | 'evidence') => string
}
