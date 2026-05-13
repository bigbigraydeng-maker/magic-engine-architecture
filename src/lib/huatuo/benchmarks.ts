/**
 * Benchmarks Lookup — 从 industry_benchmarks 表读取华佗 Agent 所需的基准数据。
 *
 * 流程：
 *   1. industry_category 精确匹配
 *   2. 如果没匹配到，回退到 industry_category='_generic_smb'（如已录入）
 *   3. 全部空 → 返回 null（华佗 Agent 会标注"无基准锚定"）
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  HuatuoLookupContext,
  IndustryBenchmarkRow,
  BenchmarkDimension,
  BusinessSize,
  BenchmarkMarket,
} from './types'

export interface BenchmarkLookupParams {
  industryCategory: string | null
  businessSize?: BusinessSize     // 默认 'small'
  market?: BenchmarkMarket        // 默认 'AU_NZ'
}

const ALL_DIMENSIONS: BenchmarkDimension[] = ['seo', 'social', 'reputation', 'ai_visibility']

/**
 * 拉取 4 个维度的基准（如果某维度没有，对应字段为 null）。
 */
export async function fetchBenchmarks(
  supabase: SupabaseClient,
  params: BenchmarkLookupParams,
): Promise<HuatuoLookupContext['benchmarks']> {
  const { industryCategory } = params
  const businessSize = params.businessSize ?? 'small'
  const market = params.market ?? 'AU_NZ'

  // 空行业 → 直接返回全 null（agent 会用通用兜底逻辑）
  if (!industryCategory) {
    return { seo: null, social: null, reputation: null, ai_visibility: null }
  }

  // 一次性查 4 维（按 dimension IN）
  const { data, error } = await supabase
    .from('industry_benchmarks')
    .select('*')
    .eq('industry_category', industryCategory)
    .eq('business_size', businessSize)
    .eq('market', market)
    .in('dimension', ALL_DIMENSIONS)

  if (error) {
    console.error('[huatuo/benchmarks] lookup error', error)
    return { seo: null, social: null, reputation: null, ai_visibility: null }
  }

  const rows = (data ?? []) as IndustryBenchmarkRow[]
  const result: HuatuoLookupContext['benchmarks'] = {
    seo: null, social: null, reputation: null, ai_visibility: null,
  }
  for (const row of rows) {
    result[row.dimension] = row
  }
  return result
}

/**
 * 把基准数据格式化成 Claude prompt 里嵌入的中文表格。
 */
export function formatBenchmarksForPrompt(
  benchmarks: HuatuoLookupContext['benchmarks'],
  industryName: string,
): string {
  const lines: string[] = [
    `## 行业基准数据（${industryName}，AU/NZ 小型企业）`,
    '',
    '| 维度 | P50 | P75 | P90 | 3月可实现增长 | 6月可实现增长 | 典型月预算(AUD) | 数据置信度 | 来源 |',
    '|------|-----|-----|-----|--------------|--------------|----------------|----------|------|',
  ]

  const labelMap: Record<BenchmarkDimension, string> = {
    seo: 'SEO',
    social: '社媒',
    reputation: '口碑',
    ai_visibility: 'AI可见度',
  }

  for (const dim of ALL_DIMENSIONS) {
    const b = benchmarks[dim]
    if (!b) {
      lines.push(`| ${labelMap[dim]} | — | — | — | — | — | — | 无数据 | — |`)
    } else {
      lines.push(
        `| ${labelMap[dim]} | ${b.score_p50 ?? '—'} | ${b.score_p75 ?? '—'} | ${b.score_p90 ?? '—'} | ` +
        `${b.realistic_3mo_growth_pct ?? '—'}% | ${b.realistic_6mo_growth_pct ?? '—'}% | ` +
        `${b.typical_monthly_budget_aud ?? '—'} | ${b.confidence.toFixed(2)} | ${b.source ?? '估算'} |`
      )
    }
  }

  lines.push('')
  lines.push('**重要**：KPI target_value 必须落在该行业 P50–P90 区间内，超出者标记 realism_confidence ≤ 0.5。')
  return lines.join('\n')
}

/**
 * 提取本次使用的所有 benchmark ID（用于审计/溯源）
 */
export function extractBenchmarkIds(benchmarks: HuatuoLookupContext['benchmarks']): string[] {
  return ALL_DIMENSIONS
    .map(d => benchmarks[d]?.id)
    .filter((id): id is string => Boolean(id))
}
