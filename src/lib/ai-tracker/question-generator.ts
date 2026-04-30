/**
 * AI Visibility Tracker — Industry question generator.
 *
 * Generates 10-25 industry questions that potential customers would ask
 * AI assistants (ChatGPT, Claude, Perplexity) about the client's category.
 * These questions form the basis for tracking the client's brand visibility
 * across AI engines.
 *
 * Geographic context: AU/NZ market is the 2026 default. Every generated
 * question MUST include a market signal (e.g. "in New Zealand",
 * "for Australian businesses"). See CLAUDE.md §十二.
 *
 * Reference: ROADMAP.md P7.1.2, ARCHITECTURE.md §12
 */

import { callClaudeChat, parseJsonResponse } from '../anthropic/client'
import { supabaseAdmin } from '../supabase'
import type {
  GenerateQuestionsRequest,
  GenerateQuestionsResult,
  GeneratedQuestion,
  MarketTag,
} from '@/types/magic-engine'

const QUESTION_GENERATOR_SYSTEM_PROMPT = `You are an SEO and AI-visibility strategist
specialised in the Australian and New Zealand markets.

Your task: generate industry questions that real prospective customers
would ask AI assistants (ChatGPT, Claude, Perplexity) when researching
products or services in the client's category. These questions will be
used to track how AI engines rank brands in this category.

RULES:
1. Output ONLY valid JSON — no prose, no markdown fences, no explanation.
2. Every question MUST include explicit geographic context for the
   client's target market (e.g. "in New Zealand", "for Australian
   businesses", "across Australia and NZ").
3. Use AU/NZ English spelling (e.g. "specialise", "organisation").
4. Reflect LOCAL search intent — questions a real Kiwi or Aussie
   would type, not generic global questions.
5. Spread across these categories:
   - comparison      ("best X for Y in NZ", "top X providers in Australia")
   - recommendation  ("which X should I use for...")
   - how_to          ("how do I...", "what's the best way to...")
   - decision        ("X vs Y for Australian users", "should I choose X or Y")
   - discovery       ("what is X", "how does X work in NZ")
6. Avoid brand-specific questions (don't mention the client's brand by
   name — we want to find out IF and WHEN AI mentions them organically).
7. Each question 8-25 words. Natural conversational tone.
8. Coverage: include both top-of-funnel ("what is...") and
   decision-stage ("best X for...") questions.

OUTPUT JSON SCHEMA (follow exactly):
{
  "questions": [
    {
      "question": "string — the question text, 8-25 words, with geographic context",
      "category": "comparison | how_to | recommendation | decision | discovery",
      "market_tag": "au | nz | au-nz | global",
      "rationale": "string — 1 sentence on why this question matters for the brand"
    }
  ]
}`

interface ClientRow {
  id: string
  name: string
  domain: string | null
  semrush_db: string | null
}

interface MasterBriefRow {
  brand_name: string | null
  core_proposition: string | null
  content_pillars: unknown
  target_audience: unknown
  competitor_domains: string[] | null
  keyword_seeds: string[] | null
}

/**
 * Generate industry questions for a client based on their Master Brief.
 * Does NOT persist to database — caller is responsible for inserting
 * the returned questions into ai_visibility_queries.
 */
export async function generateQuestionsForClient(
  req: GenerateQuestionsRequest
): Promise<GenerateQuestionsResult> {
  const { clientId, count, market, contextHint } = normaliseRequest(req)

  // Load client info
  const { data: client, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('id, name, domain, semrush_db')
    .eq('id', clientId)
    .single<ClientRow>()

  if (clientErr || !client) {
    throw new Error(
      `Client not found: ${clientId} (${clientErr?.message ?? 'no row'})`
    )
  }

  // Load active master_brief (optional — fall back to client info if absent)
  const { data: brief } = await supabaseAdmin
    .from('master_briefs')
    .select(
      'brand_name, core_proposition, content_pillars, target_audience, competitor_domains, keyword_seeds'
    )
    .eq('client_id', clientId)
    .eq('status', 'active')
    .maybeSingle<MasterBriefRow>()

  const userMessage = buildUserMessage({
    client,
    brief,
    count,
    market,
    contextHint,
  })

  const response = await callClaudeChat({
    systemPrompt: QUESTION_GENERATOR_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    maxOutputTokens: 4096,
  })

  const parsed = parseJsonResponse<{ questions: GeneratedQuestion[] }>(
    response.text
  )

  const questions = (parsed.questions ?? [])
    .filter(isValidQuestion)
    .slice(0, count)

  if (questions.length === 0) {
    throw new Error(
      'Question generator returned no valid questions. Raw response: ' +
        response.text.slice(0, 400)
    )
  }

  return {
    questions,
    cost_usd: response.cost_usd,
    input_tokens: response.input_tokens,
    output_tokens: response.output_tokens,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normaliseRequest(req: GenerateQuestionsRequest): {
  clientId: string
  count: number
  market: MarketTag
  contextHint?: string
} {
  if (!req.client_id) {
    throw new Error('client_id is required')
  }
  const count = Math.max(10, Math.min(25, req.count ?? 18))
  const market = req.market ?? 'au-nz'
  return {
    clientId: req.client_id,
    count,
    market,
    contextHint: req.context_hint?.trim() || undefined,
  }
}

function buildUserMessage(input: {
  client: ClientRow
  brief: MasterBriefRow | null
  count: number
  market: MarketTag
  contextHint?: string
}): string {
  const { client, brief, count, market, contextHint } = input

  const lines: string[] = [
    `Generate ${count} industry questions for the following brand.`,
    '',
    `## Brand`,
    `- Name: ${brief?.brand_name ?? client.name}`,
    `- Website: ${client.domain ?? '(not provided)'}`,
  ]

  if (brief?.core_proposition) {
    lines.push(`- Core proposition: ${brief.core_proposition}`)
  }

  if (brief?.target_audience) {
    lines.push(`- Target audience: ${JSON.stringify(brief.target_audience)}`)
  }

  if (brief?.content_pillars) {
    lines.push(`- Content pillars: ${JSON.stringify(brief.content_pillars)}`)
  }

  if (brief?.competitor_domains?.length) {
    lines.push(`- Known competitors: ${brief.competitor_domains.join(', ')}`)
  }

  if (brief?.keyword_seeds?.length) {
    lines.push(`- Seed keywords: ${brief.keyword_seeds.join(', ')}`)
  }

  lines.push('')
  lines.push(`## Target market`)
  lines.push(`- Market tag: ${market}`)
  lines.push(
    market === 'au'
      ? '- Geographic context: Australia (use phrases like "in Australia", "for Aussie businesses")'
      : market === 'nz'
        ? '- Geographic context: New Zealand (use phrases like "in New Zealand", "for Kiwi customers")'
        : market === 'au-nz'
          ? '- Geographic context: Australia and New Zealand (use phrases like "in Australia and NZ", "for AU/NZ market")'
          : '- Geographic context: global (no specific country anchor)'
  )

  if (contextHint) {
    lines.push('')
    lines.push(`## Additional context from operator`)
    lines.push(contextHint)
  }

  lines.push('')
  lines.push(
    `Return EXACTLY ${count} questions in the JSON format defined in the system prompt.`
  )

  return lines.join('\n')
}

function isValidQuestion(q: unknown): q is GeneratedQuestion {
  if (!q || typeof q !== 'object') return false
  const obj = q as Record<string, unknown>
  return (
    typeof obj.question === 'string' &&
    obj.question.trim().length >= 10 &&
    typeof obj.category === 'string' &&
    typeof obj.market_tag === 'string' &&
    typeof obj.rationale === 'string'
  )
}
