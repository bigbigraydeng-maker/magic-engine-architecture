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

/** 一条与成功观测一一对应的证据行。`raw_response` 是答案正文，`citations` 逐字保留。 */
export function makeEvidence(overrides: Partial<GeoEvidenceRow> = {}): GeoEvidenceRow {
  return {
    id: 'ev-0001',
    client_id: ROMAN_CLIENT_ID,
    observation_id: 'obs-0001',
    raw_response: 'A generic answer.',
    raw_response_unknown_reason: null,
    raw_response_locator: 'geo_evidence/ev-0001#raw_response',
    citations: [],
    created_at: '2026-08-12T02:00:00.000Z',
    ...overrides,
  }
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
