import type { StrategyItem } from '@/lib/strategy/types'
import type { GenerateBlogRequest } from '@/types/magic-engine'

export interface GapKeywordBlogInput {
  keyword: string
  search_volume: number | null
  keyword_difficulty: number | null
  intent: string
}

export function buildStrategyBlogRequest(item: StrategyItem): GenerateBlogRequest {
  return {
    mode: item.content_mode,
    topic: item.proposed_title,
    source_query_id: item.source_query_id ?? undefined,
    source_query_text: item.source_keyword ?? item.proposed_title,
    primary_keyword: item.source_keyword ?? undefined,
    keyword_volume: item.keyword_volume ?? undefined,
    keyword_kd: item.keyword_kd ?? undefined,
    word_count_target: 1200,
    skip_audit: false,
    strategy_item_id: item.id,
  }
}

export function buildGapKeywordBlogRequest(keyword: GapKeywordBlogInput): GenerateBlogRequest {
  return {
    mode: 'seo_only',
    topic: keyword.keyword,
    source_query_text: keyword.keyword,
    primary_keyword: keyword.keyword,
    keyword_volume: keyword.search_volume ?? undefined,
    keyword_kd: keyword.keyword_difficulty ?? undefined,
    keyword_intent: keyword.intent,
    word_count_target: 1200,
    skip_audit: false,
  }
}
