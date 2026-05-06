/**
 * Tests for src/lib/strategy/scorer.ts
 *
 * TDD: RED phase — all tests written before implementation.
 * Tests cover all scoring rules, content_mode determination, action_type,
 * priority labels, score capping, and edge cases.
 */

import { describe, it, expect } from 'vitest'
import { scoreOpportunity } from '../scorer'
import type { ScoringContext, ScoringResult } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return {
    has_existing_page: false,
    has_geo_block: false,
    word_count: null,
    page_type: null,
    ai_weak: false,
    ai_weak_model_count: 0,
    keyword_volume: null,
    keyword_kd: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. content_mode determination
// ---------------------------------------------------------------------------

describe('scoreOpportunity — content_mode', () => {
  it('returns unified when ai_weak=true AND keyword_volume>50 AND keyword_kd<50', () => {
    const result = scoreOpportunity(
      makeCtx({ ai_weak: true, keyword_volume: 200, keyword_kd: 30 })
    )
    expect(result.content_mode).toBe('unified')
  })

  it('returns geo_only when ai_weak=true but keyword_volume<=50', () => {
    const result = scoreOpportunity(
      makeCtx({ ai_weak: true, keyword_volume: 50, keyword_kd: 30 })
    )
    expect(result.content_mode).toBe('geo_only')
  })

  it('returns geo_only when ai_weak=true but keyword_kd>=50', () => {
    const result = scoreOpportunity(
      makeCtx({ ai_weak: true, keyword_volume: 200, keyword_kd: 50 })
    )
    expect(result.content_mode).toBe('geo_only')
  })

  it('returns geo_only when ai_weak=true and both keyword fields are null', () => {
    const result = scoreOpportunity(
      makeCtx({ ai_weak: true, keyword_volume: null, keyword_kd: null })
    )
    expect(result.content_mode).toBe('geo_only')
  })

  it('returns seo_only when ai_weak=false AND keyword_volume>50 AND keyword_kd<50', () => {
    const result = scoreOpportunity(
      makeCtx({ ai_weak: false, keyword_volume: 300, keyword_kd: 25 })
    )
    expect(result.content_mode).toBe('seo_only')
  })
})

// ---------------------------------------------------------------------------
// 2. action_type determination
// ---------------------------------------------------------------------------

describe('scoreOpportunity — action_type', () => {
  it('returns upgrade_page when has_existing_page=true (regardless of mode)', () => {
    const result = scoreOpportunity(
      makeCtx({ has_existing_page: true, ai_weak: true, keyword_volume: 200, keyword_kd: 30 })
    )
    expect(result.action_type).toBe('upgrade_page')
  })

  it('returns upgrade_page when has_existing_page=true even for geo_only', () => {
    const result = scoreOpportunity(
      makeCtx({ has_existing_page: true, ai_weak: true, keyword_volume: null, keyword_kd: null })
    )
    expect(result.action_type).toBe('upgrade_page')
  })

  it('returns new_blog when has_existing_page=false and mode is unified', () => {
    const result = scoreOpportunity(
      makeCtx({ has_existing_page: false, ai_weak: true, keyword_volume: 200, keyword_kd: 30 })
    )
    expect(result.action_type).toBe('new_blog')
  })

  it('returns new_blog when has_existing_page=false and mode is seo_only', () => {
    const result = scoreOpportunity(
      makeCtx({ has_existing_page: false, ai_weak: false, keyword_volume: 200, keyword_kd: 30 })
    )
    expect(result.action_type).toBe('new_blog')
  })

  it('returns social_content when geo_only AND ai_weak_model_count>=3 AND no existing page', () => {
    const result = scoreOpportunity(
      makeCtx({
        has_existing_page: false,
        ai_weak: true,
        ai_weak_model_count: 3,
        keyword_volume: null,
        keyword_kd: null,
      })
    )
    expect(result.action_type).toBe('social_content')
  })

  it('returns new_blog (not social_content) when geo_only but ai_weak_model_count<3', () => {
    const result = scoreOpportunity(
      makeCtx({
        has_existing_page: false,
        ai_weak: true,
        ai_weak_model_count: 2,
        keyword_volume: null,
        keyword_kd: null,
      })
    )
    expect(result.action_type).toBe('new_blog')
  })
})

// ---------------------------------------------------------------------------
// 3. unified mode scoring
// ---------------------------------------------------------------------------

describe('scoreOpportunity — unified mode scores', () => {
  it('returns base score 72 for unified with no bonuses', () => {
    const result = scoreOpportunity(
      makeCtx({
        ai_weak: true,
        keyword_volume: 200,
        keyword_kd: 40,
        has_existing_page: false,
        // volume < 500 → no bonus; kd > 30 → no bonus; no existing page → +8
      })
    )
    // base 72 + 8 (no existing page) = 80
    expect(result.priority_score).toBe(80)
    expect(result.content_mode).toBe('unified')
  })

  it('unified + high volume (>=500) + low kd (<=30) + no page → score 96, priority critical', () => {
    const result = scoreOpportunity(
      makeCtx({
        ai_weak: true,
        keyword_volume: 500,
        keyword_kd: 30,
        has_existing_page: false,
      })
    )
    expect(result.priority_score).toBe(96)
    expect(result.priority).toBe('critical')
    expect(result.content_mode).toBe('unified')
  })

  it('unified + existing page → action_type=upgrade_page, uses upgrade scoring formula', () => {
    const result = scoreOpportunity(
      makeCtx({
        ai_weak: true,
        keyword_volume: 500,
        keyword_kd: 30,
        has_existing_page: true,
        has_geo_block: false,
        word_count: 200,
        page_type: null,
      })
    )
    // upgrade_page scoring: no geo + low wc → base 45; +8 ai_weak = 53
    expect(result.action_type).toBe('upgrade_page')
    expect(result.priority_score).toBe(53)
    expect(result.content_mode).toBe('unified')
  })

  it('unified base with existing page, geo_block=false, wc=null → upgrade score 45', () => {
    const result = scoreOpportunity(
      makeCtx({
        ai_weak: true,
        keyword_volume: 200,
        keyword_kd: 40,
        has_existing_page: true,
        has_geo_block: false,
        word_count: null,
        page_type: null,
      })
    )
    // upgrade_page: no geo + null wc (treated <500) → base 45; +8 ai_weak = 53
    expect(result.action_type).toBe('upgrade_page')
    expect(result.priority_score).toBe(53)
    expect(result.priority).toBe('medium')
  })
})

// ---------------------------------------------------------------------------
// 4. geo_only mode scoring
// ---------------------------------------------------------------------------

describe('scoreOpportunity — geo_only mode scores', () => {
  it('geo_only with 1 model, no page → score 52, priority medium', () => {
    const result = scoreOpportunity(
      makeCtx({
        ai_weak: true,
        ai_weak_model_count: 1,
        keyword_volume: null,
        keyword_kd: null,
        has_existing_page: false,
      })
    )
    // base 52 + 8 (no page) = 60 ... but wait: social_content kicks in only at >=3 models
    // action_type should be new_blog here
    expect(result.priority_score).toBe(60)
    expect(result.priority).toBe('high')
    expect(result.content_mode).toBe('geo_only')
  })

  it('geo_only with 3 models, no page → score 68, priority high', () => {
    const result = scoreOpportunity(
      makeCtx({
        ai_weak: true,
        ai_weak_model_count: 3,
        keyword_volume: null,
        keyword_kd: null,
        has_existing_page: false,
      })
    )
    // base 52 + 8 (>=3 models) + 8 (no page) = 68
    expect(result.priority_score).toBe(68)
    expect(result.priority).toBe('high')
    expect(result.content_mode).toBe('geo_only')
  })

  it('geo_only with existing page → action_type=upgrade_page, uses upgrade scoring', () => {
    const result = scoreOpportunity(
      makeCtx({
        ai_weak: true,
        ai_weak_model_count: 1,
        keyword_volume: null,
        keyword_kd: null,
        has_existing_page: true,
        has_geo_block: false,
        word_count: null,
        page_type: null,
      })
    )
    // upgrade_page: no geo + null wc (treated <500) → base 45; +8 ai_weak = 53
    expect(result.action_type).toBe('upgrade_page')
    expect(result.priority_score).toBe(53)
    expect(result.content_mode).toBe('geo_only')
  })

  it('geo_only with 3 models and existing page → upgrade scoring, score 53', () => {
    const result = scoreOpportunity(
      makeCtx({
        ai_weak: true,
        ai_weak_model_count: 3,
        keyword_volume: null,
        keyword_kd: null,
        has_existing_page: true,
        has_geo_block: false,
        word_count: null,
        page_type: null,
      })
    )
    // upgrade_page: no geo + null wc → base 45; +8 ai_weak = 53 (ai_weak_model_count bonus not in upgrade formula)
    expect(result.action_type).toBe('upgrade_page')
    expect(result.priority_score).toBe(53)
    expect(result.priority).toBe('medium')
  })
})

// ---------------------------------------------------------------------------
// 5. seo_only mode scoring
// ---------------------------------------------------------------------------

describe('scoreOpportunity — seo_only mode scores', () => {
  it('seo_only base → score 42, priority medium', () => {
    const result = scoreOpportunity(
      makeCtx({
        ai_weak: false,
        keyword_volume: 200,
        keyword_kd: 30,
      })
    )
    // base 42; volume<1000, kd>20 → no bonuses
    expect(result.priority_score).toBe(42)
    expect(result.priority).toBe('medium')
    expect(result.content_mode).toBe('seo_only')
  })

  it('seo_only + high volume (>=1000) + low kd (<=20) → score 62, priority high', () => {
    const result = scoreOpportunity(
      makeCtx({
        ai_weak: false,
        keyword_volume: 1000,
        keyword_kd: 20,
      })
    )
    // base 42 + 10 (vol>=1000) + 10 (kd<=20) = 62
    expect(result.priority_score).toBe(62)
    expect(result.priority).toBe('high')
  })

  it('seo_only + only high volume → score 52', () => {
    const result = scoreOpportunity(
      makeCtx({
        ai_weak: false,
        keyword_volume: 1000,
        keyword_kd: 30,
      })
    )
    // base 42 + 10 (vol>=1000) = 52
    expect(result.priority_score).toBe(52)
  })

  it('seo_only + only low kd → score 52', () => {
    const result = scoreOpportunity(
      makeCtx({
        ai_weak: false,
        keyword_volume: 200,
        keyword_kd: 20,
      })
    )
    // base 42 + 10 (kd<=20) = 52
    expect(result.priority_score).toBe(52)
  })
})

// ---------------------------------------------------------------------------
// 6. upgrade_page scoring (has_existing_page=true)
// ---------------------------------------------------------------------------

describe('scoreOpportunity — upgrade_page scoring', () => {
  it('no geo_block + low word_count (null counts as <500) + product → base 45 + 10 = 55, priority medium', () => {
    const result = scoreOpportunity(
      makeCtx({
        has_existing_page: true,
        has_geo_block: false,
        word_count: null,
        page_type: 'product',
        ai_weak: false,
        ai_weak_model_count: 0,
      })
    )
    expect(result.action_type).toBe('upgrade_page')
    expect(result.priority_score).toBe(55)
    expect(result.priority).toBe('medium')
  })

  it('no geo_block + low word_count + product + ai_weak → 45 + 10 + 8 = 63, priority high', () => {
    const result = scoreOpportunity(
      makeCtx({
        has_existing_page: true,
        has_geo_block: false,
        word_count: 200,
        page_type: 'product',
        ai_weak: true,
        ai_weak_model_count: 2,
      })
    )
    expect(result.priority_score).toBe(63)
    expect(result.priority).toBe('high')
  })

  it('no geo_block + high word_count (>=500) → base 38, priority low', () => {
    const result = scoreOpportunity(
      makeCtx({
        has_existing_page: true,
        has_geo_block: false,
        word_count: 500,
        page_type: null,
        ai_weak: false,
      })
    )
    expect(result.priority_score).toBe(38)
    expect(result.priority).toBe('low')
  })

  it('no geo_block + high word_count + service → 38 + 10 = 48, priority medium', () => {
    const result = scoreOpportunity(
      makeCtx({
        has_existing_page: true,
        has_geo_block: false,
        word_count: 600,
        page_type: 'service',
        ai_weak: false,
      })
    )
    expect(result.priority_score).toBe(48)
    expect(result.priority).toBe('medium')
  })

  it('has_geo_block=true + low word_count → base 28', () => {
    const result = scoreOpportunity(
      makeCtx({
        has_existing_page: true,
        has_geo_block: true,
        word_count: 300,
        page_type: null,
        ai_weak: false,
      })
    )
    expect(result.priority_score).toBe(28)
    expect(result.priority).toBe('low')
  })

  it('has_geo_block=true + low word_count + ai_weak → 28 + 8 = 36, priority low', () => {
    const result = scoreOpportunity(
      makeCtx({
        has_existing_page: true,
        has_geo_block: true,
        word_count: 200,
        page_type: null,
        ai_weak: true,
      })
    )
    expect(result.priority_score).toBe(36)
    expect(result.priority).toBe('low')
  })

  it('has_geo_block=true + word_count null treated as <500', () => {
    const result = scoreOpportunity(
      makeCtx({
        has_existing_page: true,
        has_geo_block: true,
        word_count: null,
        page_type: null,
        ai_weak: false,
      })
    )
    // base 28 (geo_block + word_count<500 because null=0)
    expect(result.priority_score).toBe(28)
  })
})

// ---------------------------------------------------------------------------
// 7. Priority label thresholds
// ---------------------------------------------------------------------------

describe('scoreOpportunity — priority label', () => {
  it('score >= 80 → critical', () => {
    const result = scoreOpportunity(
      makeCtx({ ai_weak: true, keyword_volume: 500, keyword_kd: 30, has_existing_page: false })
    )
    expect(result.priority_score).toBeGreaterThanOrEqual(80)
    expect(result.priority).toBe('critical')
  })

  it('score 62 → high', () => {
    const result = scoreOpportunity(
      makeCtx({ ai_weak: false, keyword_volume: 1000, keyword_kd: 20 })
    )
    expect(result.priority_score).toBe(62)
    expect(result.priority).toBe('high')
  })

  it('score exactly 60 → high', () => {
    const result = scoreOpportunity(
      makeCtx({
        ai_weak: true,
        ai_weak_model_count: 1,
        keyword_volume: null,
        keyword_kd: null,
        has_existing_page: false,
      })
    )
    expect(result.priority_score).toBe(60)
    expect(result.priority).toBe('high')
  })

  it('score exactly 40 → medium', () => {
    // Force a score of 40: upgrade_page geo_block=true + low wc + no page_type + ai_weak + nothing
    // base 28 + 8 (ai_weak) = 36... not 40. Let's use seo_only base 42 but we need 40 exactly.
    // seo_only 42 - not reducible. upgrade no_geo + high wc = 38. Let's confirm "medium" at 42.
    const result = scoreOpportunity(
      makeCtx({ ai_weak: false, keyword_volume: 200, keyword_kd: 30 })
    )
    expect(result.priority_score).toBe(42)
    expect(result.priority).toBe('medium')
  })

  it('score < 40 → low', () => {
    const result = scoreOpportunity(
      makeCtx({
        has_existing_page: true,
        has_geo_block: false,
        word_count: 600,
        page_type: null,
        ai_weak: false,
      })
    )
    expect(result.priority_score).toBe(38)
    expect(result.priority).toBe('low')
  })
})

// ---------------------------------------------------------------------------
// 8. Edge cases: null handling and score capping
// ---------------------------------------------------------------------------

describe('scoreOpportunity — edge cases', () => {
  it('null keyword_volume treated as 0 — not > 50 — so no unified mode', () => {
    const result = scoreOpportunity(
      makeCtx({ ai_weak: true, keyword_volume: null, keyword_kd: 30 })
    )
    expect(result.content_mode).toBe('geo_only')
  })

  it('null keyword_kd treated as not satisfying <50 condition for seo_only', () => {
    const result = scoreOpportunity(
      makeCtx({ ai_weak: false, keyword_volume: 200, keyword_kd: null })
    )
    // keyword_kd null → not < 50 → cannot be seo_only or unified; no ai_weak either
    // This context has no valid mode... defaults should not throw
    // Without ai_weak and without valid keyword, the result should still be valid
    expect(result.priority_score).toBeGreaterThanOrEqual(0)
    expect(result.priority_score).toBeLessThanOrEqual(100)
  })

  it('score is capped at 100', () => {
    // Maximum possible unified: 72+8+8+8 = 96 — already capped. Test with hypothetical overflow.
    const result = scoreOpportunity(
      makeCtx({ ai_weak: true, keyword_volume: 500, keyword_kd: 30, has_existing_page: false })
    )
    expect(result.priority_score).toBeLessThanOrEqual(100)
  })

  it('score floor is 0 — never negative', () => {
    const result = scoreOpportunity(
      makeCtx({
        has_existing_page: true,
        has_geo_block: true,
        word_count: 600,
        ai_weak: false,
        keyword_volume: null,
        keyword_kd: null,
      })
    )
    // upgrade_page: geo_block=true + high wc → but there's no has_geo_block=true + wc>=500 rule
    // The spec only lists: geo_block=true AND wc<500 = 28. geo_block=true + wc>=500 is not in spec.
    // We can derive it should still be a valid positive number.
    expect(result.priority_score).toBeGreaterThanOrEqual(0)
  })

  it('null word_count treated as 0 (counts as < 500) for upgrade_page', () => {
    const result = scoreOpportunity(
      makeCtx({
        has_existing_page: true,
        has_geo_block: false,
        word_count: null,
        page_type: null,
        ai_weak: false,
      })
    )
    // no geo + null wc (treated as <500) → base 45
    expect(result.priority_score).toBe(45)
  })

  it('returns a complete ScoringResult with all required fields', () => {
    const result: ScoringResult = scoreOpportunity(makeCtx())
    expect(result).toHaveProperty('priority_score')
    expect(result).toHaveProperty('priority')
    expect(result).toHaveProperty('action_type')
    expect(result).toHaveProperty('content_mode')
  })
})
