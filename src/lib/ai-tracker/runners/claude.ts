/**
 * AI Visibility Tracker — Claude (Strategy Engine) runner.
 *
 * ⚠️  DISABLED (P7.1.13): Hits Anthropic 30k tokens/min rate limit under
 * multi-query load. Code retained for future re-enablement or GEO Composer.
 * Active engines: openai, perplexity, google (Gemini).
 *
 * To re-enable: set AI_TRACKER_ENABLE_CLAUDE=true in environment.
 *
 * Reference: ROADMAP.md P7.1.6, P7.1.13, ARCHITECTURE.md §12.4
 */

import Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_SONNET } from '../../anthropic/client'
import { marketToLocation, type RunnerInput, type RunnerOutput } from './types'

// Sonnet 4.5 pricing per million tokens
const PRICE_INPUT_PER_M = 3.0
const PRICE_OUTPUT_PER_M = 15.0

// Web search tool version compatible with claude-sonnet-4-5-20250929
const WEB_SEARCH_TOOL_VERSION = 'web_search_20250305' as const
const MAX_WEB_SEARCHES = 5

export async function runClaude(input: RunnerInput): Promise<RunnerOutput> {
  const start = Date.now()

  // Guard: disabled by default due to rate limit issues (P7.1.13)
  if (process.env.AI_TRACKER_ENABLE_CLAUDE !== 'true') {
    return {
      ai_engine: 'anthropic',
      ai_model: MODEL_SONNET,
      raw_response: '',
      citations: [],
      tokens_used: null,
      cost_usd: null,
      latency_ms: 0,
      error_message: 'Claude runner is disabled (rate limit). Set AI_TRACKER_ENABLE_CLAUDE=true to re-enable.',
    }
  }

  const { country, timezone } = marketToLocation(input.market)

  const userLocation =
    country !== null
      ? {
          type: 'approximate' as const,
          country,
          ...(timezone ? { timezone } : {}),
        }
      : undefined

  // SDK 0.32.1's Tool type doesn't include the server-side web_search tool
  // shape; cast to the SDK's tool array param via unknown.
  const tools = [
    {
      type: WEB_SEARCH_TOOL_VERSION,
      name: 'web_search',
      max_uses: MAX_WEB_SEARCHES,
      ...(userLocation ? { user_location: userLocation } : {}),
    },
  ] as unknown as Anthropic.MessageCreateParams['tools']

  try {
    const client = getAnthropicClient()
    const message = await client.messages.create({
      model: MODEL_SONNET,
      max_tokens: 4096,
      tools,
      messages: [{ role: 'user', content: input.question }],
    })

    const rawResponse = extractAssistantText(message.content)
    const citations = extractCitations(message.content)

    const inputTok = message.usage.input_tokens
    const outputTok = message.usage.output_tokens
    const costUsd =
      (inputTok / 1_000_000) * PRICE_INPUT_PER_M +
      (outputTok / 1_000_000) * PRICE_OUTPUT_PER_M

    return {
      ai_engine: 'anthropic',
      ai_model: MODEL_SONNET,
      raw_response: rawResponse,
      citations,
      tokens_used: inputTok + outputTok,
      cost_usd: costUsd,
      latency_ms: Date.now() - start,
      error_message: null,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return {
      ai_engine: 'anthropic',
      ai_model: MODEL_SONNET,
      raw_response: '',
      citations: [],
      tokens_used: null,
      cost_usd: null,
      latency_ms: Date.now() - start,
      error_message: message,
    }
  }
}

/**
 * Concatenate all top-level text blocks. Claude may interleave text with
 * server_tool_use and web_search_tool_result blocks; we want the natural
 * language portions only.
 */
function extractAssistantText(content: Anthropic.ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text') {
      parts.push(block.text)
    }
  }
  return parts.join('\n\n').trim()
}

/**
 * Pull URLs out of web_search_tool_result blocks for downstream citation
 * tracking. Block shape varies across SDK versions, so we narrow defensively.
 */
function extractCitations(content: Anthropic.ContentBlock[]): string[] {
  const urls: string[] = []
  for (const block of content) {
    const b = block as unknown as { type: string; content?: unknown }
    if (b.type !== 'web_search_tool_result') continue
    if (!Array.isArray(b.content)) continue
    for (const result of b.content) {
      if (result && typeof result === 'object' && 'url' in result) {
        const url = (result as { url: unknown }).url
        if (typeof url === 'string') urls.push(url)
      }
    }
  }
  return Array.from(new Set(urls))
}
