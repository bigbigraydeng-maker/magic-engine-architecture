/**
 * Magic Engine 2.0 · GEO Measurement Runtime —— 对外门面（Issue #874 / WP04）
 *
 * 🔴 这一层负责**跑一批测量**：冻结计划 → 预算 preflight → 有界假 provider 执行
 *    → WP02 校验 → 原子假 store 落库 → 诚实 completed/partial/failed。
 *
 * 🔴 只 import WP02 契约层（`@/lib/geo-measurement`）。不 import Kernel / 执行内核 /
 *    supabase / 任何真实 provider —— 架构测试盯着这条边界。v1 只有假件，绝不接生产路径。
 *
 * 🔴 可比性判定**只用** WP02 的 `evaluateGeoComparability`。这里原样转出那一个函数，
 *    WP04 内部不写、也不放宽任何可比逻辑（授权第 7 条）。
 */

export { runGeoMeasurementBatch, GeoPlanRejectedError, GeoRuntimeInvariantError } from './runtime'

export { validateFrozenPlan, MAX_PLANNED_OBSERVATIONS_PER_BATCH, type GeoPlanValidation } from './plan'
export { preflightBudget, trustProviderCost, type GeoBudgetDecision, type GeoCostTrustResult } from './budget'
export {
  toGeoBatchRow,
  toGeoObservationRow,
  toGeoEvidenceRow,
  splitMaybe,
  deriveRawResponseLocator,
} from './row-mapper'
export {
  buildPlannedCoverage,
  buildActualCoverage,
  deriveStatus,
  computeBatchQuality,
  buildComparabilityInputs,
  type GeoBatchQuality,
} from './summary'
export {
  checkObservationEvidenceIntegrity,
  checkCoverageMatchesRows,
  type GeoIntegrityResult,
} from './reconcile'

export { GeoFakeStore, GeoFakeStoreError, type StoredBatchRows } from './fake-store'
export {
  GeoFakeProvider,
  alwaysOkProvider,
  makeFakeParser,
  createSequentialIdFactory,
  fixedClock,
  type GeoFakeProviderScript,
} from './fake-provider'

// 🔴 可比性判定的唯一入口，原样转出 WP02 —— WP04 不自己判能不能比。
export { evaluateGeoComparability } from '@/lib/geo-measurement'

export type {
  GeoPlannedQuery,
  GeoFrozenPlan,
  GeoProvider,
  GeoProviderIdempotency,
  GeoProviderRequest,
  GeoProviderCallResult,
  GeoParser,
  GeoParseResult,
  GeoRuntimeStore,
  GeoBatchPersistInput,
  GeoEvidenceRecord,
  GeoStopReason,
  GeoRuntimeResult,
  GeoRuntimeDeps,
} from './types'
