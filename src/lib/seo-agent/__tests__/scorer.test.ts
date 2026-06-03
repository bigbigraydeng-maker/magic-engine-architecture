import { describe, expect, it } from 'vitest'
import { buildScoredCandidate, deriveActionType, derivePageType } from '../scorer'

describe('seo-agent scorer', () => {
  it('prefers local commercial gap keywords as money pages', () => {
    const candidate = buildScoredCandidate({
      keyword: 'hybrid flooring brisbane',
      source: 'gap',
      intent: 'commercial',
      search_volume: 320,
      keyword_difficulty: 28,
      position: null,
      previous_position: null,
      position_delta: null,
      has_business_match: true,
      has_location_match: true,
    }, null)

    expect(candidate.action_type).toBe('create_money_page')
    expect(candidate.page_type).toBe('location_page')
    expect(candidate.execution_path).toBe('manual_page_brief')
    expect(candidate.score).toBeGreaterThan(70)
  })

  it('routes informational keywords into support content', () => {
    expect(derivePageType('best waterproof flooring for kitchens', 'informational', false)).toBe('guide_article')
    expect(deriveActionType('gap', 'informational', null)).toBe('publish_support_content')
  })

  it('treats declining ranked keywords as refresh opportunities', () => {
    const candidate = buildScoredCandidate({
      keyword: 'queenstown tour packages',
      source: 'position_change',
      intent: 'commercial',
      search_volume: 210,
      keyword_difficulty: 35,
      position: 14,
      previous_position: 6,
      position_delta: -8,
      has_business_match: true,
      has_location_match: false,
    }, null)

    expect(candidate.action_type).toBe('refresh_existing_page')
    expect(candidate.execution_path).toBe('page_upgrade')
  })
})
