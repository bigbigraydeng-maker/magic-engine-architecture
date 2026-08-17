/**
 * Magic Engine 2.0 · GEO Module v1 —— 台账页解析 + PageOptimizationRequest 映射（Issue #879 / WP05）
 *
 * 纯函数、确定性、无副作用。把「AI 可见度合格提及缺口」这条 finding-链，映射成一条
 * 面向**客户台账里真实页面**的 `PageOptimizationRequest`（WP06 消费）。
 *
 * 🔴 页面身份**只来自台账解析**（`client_site_pages`），绝不猜、绝不编 URL。
 *    解析不出来就诚实 defer（Page 契约 §3.1：「Unknown Roman page identity stays
 *    explicitly unknown; never infer it」）。
 * 🔴 **读侧租户隔离**：只在**入参 clientId 名下**的台账行里解析。跨租户的行一律忽略，
 *    要求的页不在本租户台账里 → defer，绝不落到别的客户的页上。
 * 🔴 `proposedValue` 由调用方（Roman 首次诊断）给出，WP05 **不生成文案、不调 provider**
 *    （Page 契约：WP06 也不调模型，proposedValue 必须上游给）。给不出 grounding 的提案 → defer，
 *    不硬造。
 */

import {
  PAGE_OPTIMIZATION_FIELDS,
  type PageOptimizationField,
  type PageOptimizationIntent,
  type PageOptimizationRequest,
} from '@/lib/page-optimization'
import type { GrowthVerificationDefinition } from '@/lib/growth'
import { GEO_QUALIFIED_MENTION_FINDING_REF } from './finding'

/**
 * 台账读模型 —— 只取解析页面身份需要的两列，逐字对应 `client_site_pages`
 * （`supabase/migrations/20260504000001_client_site_pages.sql`：`client_id` NOT NULL、`url` NOT NULL）。
 * 不引入新 codegen，手写行接口（照 geo-measurement-store/types 的做法）。
 */
export interface SitePageRow {
  readonly client_id: string
  readonly url: string
}

/** 台账解析失败 / 请求无法构建的机器可读原因码。 */
export type GeoPageRequestReason =
  /** 要求的目标页不在**本租户**台账里 —— 不猜、不落到别人的页上。 */
  | 'unattributable_page'
  /** 没有 grounding 的字段提案（proposedValue），WP05 不硬造文案。 */
  | 'unattributable_proposed_value'
  /** 提案字段超出 v1 冻结的三字段词汇。 */
  | 'unsupported_field'

export type PageResolutionResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: GeoPageRequestReason }

/**
 * 在**本租户**台账里解析目标页 URL。
 *
 * 🔴 只认 `client_id === clientId` 的行；`targetUrl` 必须在这个集合里精确命中，
 *    否则 defer。这样「解析出来的页永远是这个客户自己台账里的页」在内存里就测得出来。
 */
export function resolveLedgerPage(
  pages: readonly SitePageRow[],
  clientId: string,
  targetUrl: string,
): PageResolutionResult {
  const owned = pages.filter((p) => p.client_id === clientId)
  const hit = owned.find((p) => p.url === targetUrl)
  if (!hit) return { ok: false, reason: 'unattributable_page' }
  return { ok: true, url: hit.url }
}

const FIELD_SET: ReadonlySet<string> = new Set(PAGE_OPTIMIZATION_FIELDS)

export interface BuildPageRequestInput {
  readonly clientId: string
  readonly resolvedPageUrl: string
  /** 调用方给定的、已 grounding 的字段级提案（至少一条）。 */
  readonly intents: readonly PageOptimizationIntent[]
  readonly verification: GrowthVerificationDefinition
}

export type BuildPageRequestResult =
  | { readonly ok: true; readonly request: PageOptimizationRequest }
  | { readonly ok: false; readonly reason: GeoPageRequestReason }

/**
 * 映射成 `PageOptimizationRequest`。
 *
 * - `page.url` 来自台账解析结果；
 * - `intents` 来自调用方（每条 field 必在三字段词汇内、proposedValue 非空）；
 * - `constraints.doNotTouch` = 三字段里**没被提案**的那些 —— 明确「只改提了的」；
 * - `lineage.findingRefs` 指回 finding，不重复携带证据；
 * - `verification` 复用同一份三档判据；
 * - `basedOnVersion` 首次提出通常未知。
 */
export function buildPageOptimizationRequest(input: BuildPageRequestInput): BuildPageRequestResult {
  const { clientId, resolvedPageUrl, intents, verification } = input
  if (intents.length === 0) {
    return { ok: false, reason: 'unattributable_proposed_value' }
  }
  const touched = new Set<PageOptimizationField>()
  for (const intent of intents) {
    if (!FIELD_SET.has(intent.field)) return { ok: false, reason: 'unsupported_field' }
    if (typeof intent.proposedValue !== 'string' || intent.proposedValue.trim().length === 0) {
      return { ok: false, reason: 'unattributable_proposed_value' }
    }
    touched.add(intent.field)
  }
  const doNotTouch = PAGE_OPTIMIZATION_FIELDS.filter((f) => !touched.has(f))
  return {
    ok: true,
    request: {
      clientId,
      page: { url: resolvedPageUrl },
      intents,
      lineage: { findingRefs: [GEO_QUALIFIED_MENTION_FINDING_REF] },
      verification,
      constraints: { doNotTouch },
      basedOnVersion: { known: false, reason: 'not_recorded_by_source' },
    },
  }
}
