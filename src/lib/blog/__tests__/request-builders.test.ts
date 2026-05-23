import { describe, expect, it } from 'vitest'
import {
  buildGapKeywordBlogRequest,
  buildStrategyBlogRequest,
} from '../request-builders'
import type { StrategyItem } from '@/lib/strategy/types'

function makeStrategyItem(overrides: Partial<StrategyItem> = {}): StrategyItem {
  return {
    id: 'strategy-1',
    client_id: 'client-1',
    strategy_run_id: 'run-1',
    action_type: 'new_blog',
    content_mode: 'unified',
    priority: 'high',
    priority_score: 82,
    proposed_title: 'Best New Zealand day tours for families',
    rationale: 'Keyword gap with AI visibility weakness',
    content_angle: 'Compare family-friendly tour options',
    source_page_id: null,
    source_query_id: 'query-1',
    source_keyword: 'new zealand family tours',
    keyword_volume: 720,
    keyword_kd: 24,
    status: 'pending',
    linked_blog_post_id: null,
    created_at: '2026-05-22T00:00:00Z',
    updated_at: '2026-05-22T00:00:00Z',
    ...overrides,
  }
}

describe('blog request builders', () => {
  it('builds a strategy-originated blog request with strategy linkage', () => {
    const request = buildStrategyBlogRequest(makeStrategyItem())

    expect(request).toMatchObject({
      mode: 'unified',
      topic: 'Best New Zealand day tours for families',
      source_query_id: 'query-1',
      source_query_text: 'new zealand family tours',
      primary_keyword: 'new zealand family tours',
      keyword_volume: 720,
      keyword_kd: 24,
      word_count_target: 1200,
      skip_audit: false,
      strategy_item_id: 'strategy-1',
    })
  })

  it('falls back to proposed title when a strategy item has no keyword', () => {
    const request = buildStrategyBlogRequest(makeStrategyItem({
      source_query_id: null,
      source_keyword: null,
      keyword_volume: null,
      keyword_kd: null,
    }))

    expect(request.source_query_id).toBeUndefined()
    expect(request.source_query_text).toBe('Best New Zealand day tours for families')
    expect(request.primary_keyword).toBeUndefined()
    expect(request.keyword_volume).toBeUndefined()
    expect(request.keyword_kd).toBeUndefined()
  })

  it('builds an untapped gap keyword request as an SEO-only post', () => {
    const request = buildGapKeywordBlogRequest({
      keyword: 'queenstown ski packages',
      search_volume: 1300,
      keyword_difficulty: 31,
      intent: 'commercial',
    })

    expect(request).toMatchObject({
      mode: 'seo_only',
      topic: 'queenstown ski packages',
      source_query_text: 'queenstown ski packages',
      primary_keyword: 'queenstown ski packages',
      keyword_volume: 1300,
      keyword_kd: 31,
      keyword_intent: 'commercial',
      word_count_target: 1200,
      skip_audit: false,
    })
  })
})
