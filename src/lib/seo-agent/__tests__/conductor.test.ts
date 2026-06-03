import { describe, expect, it, vi } from 'vitest'
import type { SeoAgentInput } from '../types'

vi.mock('@/lib/anthropic/client', () => ({
  callClaudeChat: vi.fn(),
  parseJsonResponse: (text: string) => JSON.parse(text),
}))

import { callClaudeChat } from '@/lib/anthropic/client'
import { runSeoAgent } from '../conductor'

const mockCallClaudeChat = vi.mocked(callClaudeChat)

function makeInput(): SeoAgentInput {
  return {
    client: {
      id: 'client-1',
      name: 'Oztop',
      domain: 'oztopbuildingsupplies.com.au',
      semrush_db: 'au',
      industry: 'flooring',
    },
    goal: null,
    brief: null,
    location: { city: 'Brisbane', region: 'QLD', country: 'AU', audience_location: 'Brisbane' },
    rankings_count: 24,
    gap_count: 12,
    position_change_count: 3,
    candidates: [
      {
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
        action_type: 'create_money_page',
        page_type: 'location_page',
        execution_path: 'manual_page_brief',
        score: 84,
      },
      {
        keyword: 'best waterproof flooring for kitchens',
        source: 'gap',
        intent: 'informational',
        search_volume: 140,
        keyword_difficulty: 24,
        position: null,
        previous_position: null,
        position_delta: null,
        has_business_match: true,
        has_location_match: false,
        action_type: 'publish_support_content',
        page_type: 'guide_article',
        execution_path: 'blog_now',
        score: 66,
      },
    ],
  }
}

describe('runSeoAgent', () => {
  it('normalizes LLM output back onto known candidates', async () => {
    mockCallClaudeChat.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: 'Focus on money pages first.',
        top_opportunities: [
          {
            keyword: 'hybrid flooring brisbane',
            priority: 'high',
            suggested_title: 'Hybrid Flooring Brisbane',
            suggested_slug: 'hybrid-flooring-brisbane',
            why_now: 'Direct local demand.',
            business_fit: 'High buying intent.',
          },
        ],
        skipped_keywords: ['random noise'],
      }),
      input_tokens: 1,
      output_tokens: 1,
      cost_usd: 0.01,
    })

    const result = await runSeoAgent(makeInput(), 5)
    expect(result.used_fallback).toBe(false)
    expect(result.output.top_opportunities[0].execution_path).toBe('manual_page_brief')
    expect(result.output.top_opportunities[0].recommended_mode).toBe('unified')
  })

  it('falls back to deterministic output when the model fails', async () => {
    mockCallClaudeChat.mockRejectedValueOnce(new Error('timeout'))

    const result = await runSeoAgent(makeInput(), 5)
    expect(result.used_fallback).toBe(true)
    expect(result.output.top_opportunities).toHaveLength(2)
    expect(result.output.top_opportunities[0].keyword).toBe('hybrid flooring brisbane')
  })
})
