/**
 * Magic Engine 2.0 · GEO Baseline —— 对外门面（Issue #883 / #917 · WP04A）
 *
 * 🔴 **这是一次性接线，不是平台能力。** 一个引擎、一个 parser、一个 store、
 *    一个客户、一次人工触发。没有 registry、没有多 provider 选择器、没有通用 transport 层。
 *    第二个场景出现之前不抽象（Discovery §6 C 档）。
 *
 * 🔴 真正的编排仍然在 WP04 的 `runGeoMeasurementBatch` —— 本模块**不复制**它的任何判据：
 *    预算 preflight、成本可信闸、引擎装配闸、WP02 校验、覆盖账、终态推导、可比性输入，
 *    全部照用。
 */

export { GeoBaselineOpenAiProvider, GEO_BASELINE_ENGINE_FAMILY, DEFAULT_PROVIDER_TIMEOUT_MS, buildOutboundRequest, computeCostUsd } from './provider'
export type { GeoBaselineProviderConfig, GeoBaselineProviderOptions } from './provider'

export {
  openAiTransport,
  createOpenAiTransport,
  toTransportError,
  TRANSPORT_REQUEST_OPTIONS,
} from './transport-openai'
export type { OpenAiChatClient } from './transport-openai'

export {
  buildOwnedDomainPolicy,
  requireString,
  requireNumber,
  optionalNumber,
  GeoConfigError,
} from './config'

export { createGeoBaselineParser, classifyOwnedDomain, normaliseHost, parseEnvelope } from './parser'

export {
  GeoSupabaseStore,
  GeoStoreError,
  stripGeneratedColumns,
  clampErrorMessage,
  EVIDENCE_READBACK_CHUNK,
  MAX_ERROR_MESSAGE_CHARS,
  TABLE_BATCHES,
  TABLE_OBSERVATIONS,
  TABLE_EVIDENCE,
  TABLE_QUERY_SETS,
  TABLE_QUERIES,
} from './store'
export type { GeoSupabaseStoreOptions } from './store'

export { loadFrozenQueryScope, createQuerySet, GeoQuerySetError } from './query-set'
export type { GeoQuerySetSeed } from './query-set'

export { buildFrozenPlan, summariseBudgetHeadroom, GeoPlanBuildError } from './plan-builder'
export type { GeoBaselineManifest, GeoBuiltPlan } from './plan-builder'

export type {
  GeoRawResponseEnvelope,
  GeoOutboundRequest,
  GeoTransport,
  GeoTransportError,
  GeoTransportResult,
  GeoOwnedDomainPolicy,
  GeoOwnedPagePolicy,
  GeoBaselineParserConfig,
  GeoFrozenQueryScope,
} from './types'
