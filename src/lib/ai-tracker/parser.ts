/**
 * AI Visibility Tracker — Brand ranking parser.
 *
 * Takes a natural-language response from one of the runners (OpenAI / Claude)
 * and extracts structured brand mentions + the client's own brand rank.
 *
 * Implementation: a second Strategy Engine call. Cheap (small input/output)
 * and far more robust than regex/heuristics for messy real-world text.
 *
 * Reference: ROADMAP.md P7.1.8, ARCHITECTURE.md §12.4
 */

import { callClaudeChat, parseJsonResponse } from '../anthropic/client'
import type { BrandMention } from '@/types/magic-engine'

const PARSER_SYSTEM_PROMPT = `You are a precise data extraction assistant.

Your task: read a natural-language answer that an AI assistant gave to a
consumer question, and extract every BRAND, COMPANY, or SERVICE PROVIDER
mentioned, in the order they appear.

RULES:
1. Output ONLY valid JSON — no prose, no markdown fences.
2. Extract brands/companies/operators that the AI is recommending or
   discussing as solution providers. Do NOT extract:
   - Generic terms ("local guides", "travel agents")
   - Products/destinations that aren't brands ("Great Wall", "China visa")
   - Government bodies, news outlets, or aggregators unless they ARE the
     recommended provider
3. "rank" is the 1-based ordinal position of the brand in the response. If
   the AI presents an ordered list (1. 2. 3.), use that. If it's prose, use
   the order in which the brand first appears.
4. "snippet" is a short (≤ 30 words) quote from the response showing where
   the brand was mentioned.
5. "url" is included ONLY if the response explicitly cites a URL for that
   brand. Otherwise omit the field.

OUTPUT JSON SCHEMA (follow exactly):
{
  "brands": [
    {
      "brand": "string — official brand/company name",
      "rank": 1,
      "snippet": "string — short quote (≤ 30 words)",
      "url": "string — optional, only if cited"
    }
  ]
}`

export interface ParseResult {
  brands: BrandMention[]
  /** Rank of the client's own brand if mentioned, else null. */
  client_brand_rank: number | null
  /** Cost of the parser invocation in USD. */
  parse_cost_usd: number
}

export async function parseRanking(input: {
  rawResponse: string
  clientBrandName: string
}): Promise<ParseResult> {
  const { rawResponse, clientBrandName } = input

  // Empty / very short responses can't yield meaningful rankings
  if (!rawResponse || rawResponse.trim().length < 30) {
    return { brands: [], client_brand_rank: null, parse_cost_usd: 0 }
  }

  const userMessage = [
    `## AI assistant's response`,
    rawResponse,
    '',
    `## Client brand to look for`,
    clientBrandName,
    '',
    `Extract all brands/companies/providers mentioned in the response, in the order`,
    `they appear. Return JSON in the format defined in the system prompt.`,
  ].join('\n')

  const response = await callClaudeChat({
    systemPrompt: PARSER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    maxOutputTokens: 1024,
  })

  const parsed = parseJsonResponse<{ brands: unknown[] }>(response.text)
  const brands = (parsed.brands ?? []).filter(isValidBrand)

  // Find client's own brand rank using fuzzy match (case-insensitive substring)
  // Only allow reverse match for brands ≥ 3 chars to avoid false positives
  // (e.g., "Air" matching "Air New Zealand" and "Air China")
  const clientLower = clientBrandName.toLowerCase().trim()
  const clientMention = brands.find(b => {
    const bLower = b.brand.toLowerCase()
    return (
      b.brand.toLowerCase().includes(clientLower) ||
      (clientLower.length >= 3 && bLower.length >= 3 && clientLower.includes(bLower))
    )
  })

  return {
    brands,
    client_brand_rank: clientMention?.rank ?? null,
    parse_cost_usd: response.cost_usd,
  }
}

function isValidBrand(b: unknown): b is BrandMention {
  if (!b || typeof b !== 'object') return false
  const obj = b as Record<string, unknown>
  return (
    typeof obj.brand === 'string' &&
    obj.brand.trim().length > 0 &&
    typeof obj.rank === 'number' &&
    obj.rank > 0 &&
    typeof obj.snippet === 'string'
  )
}
