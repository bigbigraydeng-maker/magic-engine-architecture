/**
 * AI Visibility Tracker — Shared Runner types.
 *
 * A "runner" sends one industry question to one AI engine and returns the
 * raw response + metadata. Parsing the response into structured brand
 * rankings happens in a separate parser module.
 *
 * Reference: ROADMAP.md P7.1.5/6, ARCHITECTURE.md §12.4
 */

import type { AiEngine, MarketTag } from '@/types/magic-engine'

export interface RunnerInput {
  /** Industry question to ask the AI engine. */
  question: string
  /** Geographic context (drives user_location parameter for web search). */
  market: MarketTag
}

export interface RunnerOutput {
  /** Engine identifier (stable across model upgrades). */
  ai_engine: AiEngine
  /** Specific model name (free-form, evolves over time). */
  ai_model: string
  /** Full natural-language response from the AI. */
  raw_response: string
  /** URLs cited via web search, if any. */
  citations: string[]
  /** Metadata for ops tracking. */
  tokens_used: number | null
  cost_usd: number | null
  latency_ms: number
  /** Populated when the call failed; raw_response will be empty. */
  error_message: string | null
}

/**
 * Map MarketTag to ISO 3166-1 alpha-2 country code + timezone.
 * Used by both runners to localize web-search results.
 */
export function marketToLocation(market: MarketTag): {
  country: 'AU' | 'NZ' | null
  timezone: string | null
} {
  switch (market) {
    case 'au':
      return { country: 'AU', timezone: 'Australia/Sydney' }
    case 'nz':
      return { country: 'NZ', timezone: 'Pacific/Auckland' }
    case 'au-nz':
      // Default to NZ when both — closer geographic relevance for Kiwi clients
      return { country: 'NZ', timezone: 'Pacific/Auckland' }
    case 'global':
    default:
      return { country: null, timezone: null }
  }
}
