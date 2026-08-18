/**
 * GEO Module v1 测试假件（Issue #879 / WP05）。
 *
 * 🔴 **照真 schema 建模，不自编形状**（feedback-test-fixtures-must-match-real-schema）：
 *    - `GeoObservationRow` / `GeoEvidenceRow` 逐列对应
 *      `supabase/migrations/20260811000001_me2_geo_measurement_storage_v1.sql`
 *      （每对 `<field>` / `<field>_unknown_reason` 恰好一个非空；失败观测无证据行）；
 *    - `SitePageRow` 对应 `client_site_pages`（`client_id`/`url` NOT NULL）。
 *    自编形状 = 生产会拒的值假件放过，正是「测试全绿生产全空」的经典事故。
 */

import type { GeoEvidenceRow, GeoObservationRow } from '@/lib/geo-measurement-store/types'
import type { SitePageRow } from '../page-request'

/** Roman 客户 id（自营主体档，只读引用）。 */
export const ROMAN_CLIENT_ID = 'e7465ac7-4f3d-4d6a-afbe-d036ab419708'
export const ROMAN_BATCH_ID = '688bd8ae-2db6-4300-b761-b850f30c32c5'

/** 一条成功观测的合法基线行 —— 每对身份字段恰好一个非空。 */
export function makeObservation(overrides: Partial<GeoObservationRow> = {}): GeoObservationRow {
  return {
    id: 'obs-0001',
    client_id: ROMAN_CLIENT_ID,
    batch_id: ROMAN_BATCH_ID,
    query_set_version: 'roman-qs@1',
    query_set_version_unknown_reason: null,
    query_key: 'q-buy-auckland',
    query_key_unknown_reason: null,
    engine_family: 'openai',
    engine_family_unknown_reason: null,
    model_version: 'gpt-baseline',
    model_version_unknown_reason: null,
    locale: 'en-NZ',
    locale_unknown_reason: null,
    market: 'nz',
    market_unknown_reason: null,
    sample_planned_count: 1,
    sample_planned_count_unknown_reason: null,
    sample_index: 0,
    sample_index_unknown_reason: null,
    sampling_parameters: {},
    sampling_parameters_unknown_reason: null,
    parser_version: 'geo-parser@2026-08-01',
    parser_version_unknown_reason: null,
    metric_rules_version: 'geo-module/m1/v1',
    metric_rules_version_unknown_reason: null,
    confidence: 0.9,
    confidence_unknown_reason: null,
    observed_at: '2026-08-12T02:00:00.000Z',
    outcome_ok: true,
    error_code: null,
    error_message: null,
    error_message_unknown_reason: 'not_applicable',
    source_observation_id: null,
    created_at: '2026-08-12T02:00:00.000Z',
    ...overrides,
  }
}

/**
 * 把答案正文包装成生产 provider 使用的 `geo-baseline/openai/v1` 信封 JSON。
 *
 * 🔴 生产 provider 存的 `raw_response` **不是**裸正文，而是
 *    `JSON.stringify({ envelope:'geo-baseline/openai/v1', text, citationUrls, rawPayload, ... })`
 *    （见 `src/lib/geo-baseline/provider.ts:242-252`）。测试假件必须照此建模，否则会掩盖
 *    M1 的信封解包闸（Codex #1032 第 5 轮 P1）。
 * 🔴 需要构造**信封损坏**场景时，直接给 `raw_response` 传裸文本 / 非法 JSON / 错版本 —— 走
 *    `makeRawEnvelope` 的旁路即可。
 */
export function makeRawEnvelope(text: string, extras: Partial<{ citationUrls: readonly string[]; rawPayload: Record<string, unknown> }> = {}): string {
  return JSON.stringify({
    envelope: 'geo-baseline/openai/v1',
    resolvedModel: 'test-model',
    text,
    refusal: null,
    finishReason: 'stop',
    citationUrls: extras.citationUrls ?? [],
    usage: { promptTokens: 0, completionTokens: 0 },
    rawPayload: extras.rawPayload ?? {},
  })
}

/**
 * 一条与成功观测一一对应的证据行。
 *
 * 🔴 `raw_response` 参数**允许**两种写法：
 *   1. 直接传答案正文字符串（约定俗成，测试写着自然）→ 自动包成 `geo-baseline/openai/v1` 信封；
 *   2. 传形如 `{envelope:...}` 的 JSON 串 → 原样保留（供「信封损坏 / 错版本」等负向用例）。
 *   判据：能否 `JSON.parse` 出一个含 `envelope` 键的对象。
 */
/**
 * 「原样传 raw_response，不做任何 envelope 自动包装」——负向用例专用（信封损坏 / 版本不认
 * / 缺 envelope 字段 / null / 空串）。别在正常用例里用它。
 */
export function makeEvidenceRaw(rawResponse: string | null, overrides: Partial<GeoEvidenceRow> = {}): GeoEvidenceRow {
  return {
    id: 'ev-0001',
    client_id: ROMAN_CLIENT_ID,
    observation_id: 'obs-0001',
    raw_response: rawResponse,
    raw_response_unknown_reason: rawResponse === null ? 'not_recorded_by_source' : null,
    raw_response_locator: 'geo_evidence/ev-0001#raw_response',
    citations: [],
    created_at: '2026-08-12T02:00:00.000Z',
    ...overrides,
  }
}

export function makeEvidence(overrides: Partial<GeoEvidenceRow> = {}): GeoEvidenceRow {
  const base: GeoEvidenceRow = {
    id: 'ev-0001',
    client_id: ROMAN_CLIENT_ID,
    observation_id: 'obs-0001',
    raw_response: makeRawEnvelope('A generic answer.'),
    raw_response_unknown_reason: null,
    raw_response_locator: 'geo_evidence/ev-0001#raw_response',
    citations: [],
    created_at: '2026-08-12T02:00:00.000Z',
    ...overrides,
  }
  // 便利：如果调用方传的是裸字符串（无 envelope 字段），自动包成信封。
  // null / undefined / 空串（信封损坏用例）与已经带 envelope 字段的 JSON 都原样保留。
  const raw = base.raw_response
  if (typeof raw === 'string' && raw.length > 0) {
    let looksLikeEnvelope = false
    try {
      const parsed = JSON.parse(raw)
      looksLikeEnvelope = typeof parsed === 'object' && parsed !== null && 'envelope' in parsed
    } catch {
      looksLikeEnvelope = false
    }
    if (!looksLikeEnvelope) {
      return { ...base, raw_response: makeRawEnvelope(raw) }
    }
  }
  return base
}

/** 一条 owned-domain 引用（romanhu.com）—— 用于「只在引用里出现」场景。 */
export function ownedCitation(): unknown {
  return {
    url: 'https://romanhu.com/about',
    domain: 'romanhu.com',
    ownedDomain: { known: true, value: true },
    ownedPage: { status: 'not_computable', reason: '无页面台账' },
  }
}

export function romanLedgerPages(): readonly SitePageRow[] {
  return [
    { client_id: ROMAN_CLIENT_ID, url: 'https://romanhu.com/' },
    { client_id: ROMAN_CLIENT_ID, url: 'https://romanhu.com/about' },
  ]
}
