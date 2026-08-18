/**
 * 选品扫描 API 的入参校验 —— **花钱闸 + 防污染闸**。纯逻辑，无 IO。
 *
 * 🔴 两条红线（设计复审 2026-08-17 子牙+魏征）：
 *   1. **花钱封顶**：`seeds` 条数、`maxResults`、`enrichCount` 直接决定调多少次付费 API。
 *      绝不让客户端无上限传 —— 服务端在这里封死，超了直接拒，不静默截断。
 *   2. **防污染**：成本假设各字段若为负/0/极值，会算出荒谬毛利、把亏本品排成爆款
 *      （踩「决策数字必须真实」红线）。这里逐字段校验正数 + 合理区间，
 *      **绝不把客户端 JSON 直接 spread 进 scanSeedKeyword**。
 *
 * API route 只负责鉴权 + 调这里 + 调 scanSeedKeyword，不自己解析 body。
 */

import type { CostAssumptions } from './product-intel/landed-cost'

/** 一次请求最多扫几个词。admin-only + 同步/流式，词多会慢会贵，封死在 5。 */
export const MAX_SEEDS_PER_REQUEST = 5
export const MAX_SEED_LENGTH = 60
/** TikTok 每词最多取几条。 */
export const MAX_RESULTS_CAP = 20
/** 其中最多几条做供货+需求验证（每条一次付费以图搜款）。 */
export const MAX_ENRICH_CAP = 5

/** v1 只支持新西兰 —— scanSeedKeyword 目前写死 US 采集 + NZ 本地价/需求。 */
export const SUPPORTED_MARKETS = ['NZ'] as const
export type SupportedMarket = typeof SUPPORTED_MARKETS[number]

/** 成本假设各字段的合理区间（含边界）。超出即拒，防污染判定。 */
const ASSUMPTION_RANGES: Record<keyof Omit<CostAssumptions, 'chargeableWeightKg' | 'asOf'>, [number, number]> = {
  fxUsdToNzd: [1.4, 2.0],
  freightNzdPerKg: [0.5, 50],
  importLevyNzd: [0, 10],
  dutyRatePct: [0, 30],
  domesticDeliveryNzd: [0, 30],
  paymentFeePct: [0, 10],
  paymentFeeFixedNzd: [0, 5],
  gstRatePct: [10, 20],
}

export interface ScanRequest {
  readonly seeds: readonly string[]
  readonly market: SupportedMarket
  readonly assumptions: Omit<CostAssumptions, 'chargeableWeightKg'>
  readonly maxResults: number
  readonly enrichCount: number
}

export type ValidationResult =
  | { ok: true; value: ScanRequest }
  | { ok: false; error: string }

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x)
}

/** 校验并组装成本假设 —— 服务端逐字段取值，不 spread 客户端对象。 */
function parseAssumptions(raw: unknown): Omit<CostAssumptions, 'chargeableWeightKg'> | string {
  if (typeof raw !== 'object' || raw === null) return '缺 assumptions'
  const obj = raw as Record<string, unknown>
  const out: Record<string, number | string> = {}

  for (const [key, [min, max]] of Object.entries(ASSUMPTION_RANGES)) {
    const v = obj[key]
    if (!isFiniteNumber(v)) return `assumptions.${key} 必须是数字`
    if (v < min || v > max) return `assumptions.${key}=${v} 超出合理区间 [${min}, ${max}]`
    out[key] = v
  }
  const asOf = obj.asOf
  if (typeof asOf !== 'string' || !asOf.trim()) return 'assumptions.asOf 必填（取数日期，要跟结果一起展示）'
  out.asOf = asOf

  return out as unknown as Omit<CostAssumptions, 'chargeableWeightKg'>
}

/** 校验并夹紧 opts 到封顶值内。超出上限直接拒（不静默截断到上限，让调用方知道）。 */
function parseOpts(raw: unknown): { maxResults: number; enrichCount: number } | string {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const maxResults = obj.maxResults ?? 10
  const enrichCount = obj.enrichCount ?? 3
  if (!isFiniteNumber(maxResults) || maxResults < 1 || maxResults > MAX_RESULTS_CAP) {
    return `maxResults 必须在 1..${MAX_RESULTS_CAP}`
  }
  if (!isFiniteNumber(enrichCount) || enrichCount < 1 || enrichCount > MAX_ENRICH_CAP) {
    return `enrichCount 必须在 1..${MAX_ENRICH_CAP}`
  }
  if (enrichCount > maxResults) return 'enrichCount 不能超过 maxResults'
  return { maxResults: Math.floor(maxResults), enrichCount: Math.floor(enrichCount) }
}

function parseSeeds(raw: unknown): string[] | string {
  if (!Array.isArray(raw)) return 'seeds 必须是数组'
  const cleaned = raw
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (cleaned.length === 0) return 'seeds 不能为空'
  if (cleaned.length > MAX_SEEDS_PER_REQUEST) {
    return `一次最多扫 ${MAX_SEEDS_PER_REQUEST} 个词（收到 ${cleaned.length} 个）—— 花钱封顶`
  }
  const tooLong = cleaned.find((s) => s.length > MAX_SEED_LENGTH)
  if (tooLong) return `种子词过长（>${MAX_SEED_LENGTH} 字符）：「${tooLong.slice(0, 30)}…」`
  // 去重（大小写归一），保原始形态里第一次出现的。
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const s of cleaned) {
    const key = s.toLowerCase()
    if (!seen.has(key)) { seen.add(key); deduped.push(s) }
  }
  return deduped
}

/** 校验整个扫描请求。任何一环不过 → `{ ok:false, error }`，API 层直接 400 回。 */
export function validateScanRequest(raw: unknown): ValidationResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: '请求体必须是 JSON 对象' }
  const body = raw as Record<string, unknown>

  const market = body.market ?? 'NZ'
  if (!SUPPORTED_MARKETS.includes(market as SupportedMarket)) {
    return { ok: false, error: `market 只支持 ${SUPPORTED_MARKETS.join('/')}（v1）` }
  }

  const seeds = parseSeeds(body.seeds)
  if (typeof seeds === 'string') return { ok: false, error: seeds }

  const assumptions = parseAssumptions(body.assumptions)
  if (typeof assumptions === 'string') return { ok: false, error: assumptions }

  const opts = parseOpts(body.opts)
  if (typeof opts === 'string') return { ok: false, error: opts }

  return {
    ok: true,
    value: {
      seeds,
      market: market as SupportedMarket,
      assumptions,
      maxResults: opts.maxResults,
      enrichCount: opts.enrichCount,
    },
  }
}
