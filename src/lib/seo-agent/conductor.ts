import { callClaudeChat, parseJsonResponse } from '@/lib/anthropic/client'
import type { SeoAgentInput, SeoAgentOutput, SeoOpportunity } from './types'

const SYSTEM_PROMPT = `You are Magic Engine's dedicated SEO orchestrator for AU/NZ clients.

Your job is to turn keyword signals into business-aware SEO priorities.

Rules:
1. Prioritize business fit, local/commercial intent, and current client goal ahead of raw search volume.
2. Prefer money pages before support content when the keyword is commercial or transactional.
3. Only recommend keywords that already exist in the provided candidate list.
4. Avoid generic noise, competitor brand terms, and irrelevant search themes.
5. Be honest about execution path:
   - manual_page_brief = needs a landing/service page brief
   - blog_now = can be generated in Blog Studio now
   - page_upgrade = should upgrade an existing page

Return strict JSON with:
{
  "summary": string,
  "top_opportunities": [
    {
      "keyword": string,
      "priority": "high" | "medium" | "low",
      "suggested_title": string,
      "suggested_slug": string,
      "why_now": string,
      "business_fit": string
    }
  ],
  "skipped_keywords": string[]
}`

export async function runSeoAgent(
  input: SeoAgentInput,
  limit = 5,
): Promise<{ output: SeoAgentOutput; cost_usd: number | null; used_fallback: boolean }> {
  if (input.candidates.length === 0) {
    return {
      output: { summary: 'No business-relevant SEO opportunities were found from the current data set.', top_opportunities: [], skipped_keywords: [] },
      cost_usd: null,
      used_fallback: true,
    }
  }

  try {
    const result = await callClaudeChat({
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(input, limit) }],
      maxOutputTokens: 2400,
    })
    const parsed = parseJsonResponse<SeoAgentOutput>(result.text)
    return {
      output: normalizeOutput(input, parsed, limit),
      cost_usd: result.cost_usd,
      used_fallback: false,
    }
  } catch {
    return {
      output: buildFallbackOutput(input, limit),
      cost_usd: null,
      used_fallback: true,
    }
  }
}

function buildUserPrompt(input: SeoAgentInput, limit: number): string {
  const goalBlock = input.goal
    ? `Active goal: ${input.goal.title} (${input.goal.intent}${input.goal.sub_type ? ` / ${input.goal.sub_type}` : ''})`
    : 'Active goal: none'

  const briefBlock = input.brief?.keyword_seeds?.length
    ? `Keyword seeds: ${input.brief.keyword_seeds.join(', ')}`
    : 'Keyword seeds: none'

  const locationLine = [input.location.city, input.location.region, input.location.country].filter(Boolean).join(', ')
  const candidates = input.candidates.map((item) => JSON.stringify(item)).join('\n')

  return [
    `Client: ${input.client.name} (${input.client.domain})`,
    `Market DB: ${input.client.semrush_db ?? 'au'}`,
    `Industry: ${input.client.industry ?? 'unknown'}`,
    goalBlock,
    briefBlock,
    `Location context: ${locationLine || input.location.audience_location || 'none'}`,
    `Rankings seen: ${input.rankings_count}`,
    `Gap keywords seen: ${input.gap_count}`,
    `Position changes seen: ${input.position_change_count}`,
    `Return at most ${limit} opportunities.`,
    'Candidate list:',
    candidates,
  ].join('\n')
}

function normalizeOutput(input: SeoAgentInput, parsed: SeoAgentOutput, limit: number): SeoAgentOutput {
  const candidateMap = new Map(input.candidates.map((item) => [item.keyword.toLowerCase(), item]))
  const top_opportunities = (parsed.top_opportunities ?? [])
    .map((item) => mergeOpportunity(candidateMap, item))
    .filter((item): item is SeoOpportunity => item !== null)
    .slice(0, limit)

  if (top_opportunities.length === 0) return buildFallbackOutput(input, limit)

  return {
    summary: typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
      ? parsed.summary.trim()
      : fallbackSummary(top_opportunities),
    top_opportunities,
    skipped_keywords: Array.isArray(parsed.skipped_keywords) ? parsed.skipped_keywords.slice(0, 10) : [],
  }
}

function mergeOpportunity(
  candidateMap: Map<string, SeoAgentInput['candidates'][number]>,
  item: Partial<SeoOpportunity>,
): SeoOpportunity | null {
  const keyword = typeof item.keyword === 'string' ? item.keyword.trim() : ''
  const candidate = candidateMap.get(keyword.toLowerCase())
  if (!candidate) return null

  return {
    keyword: candidate.keyword,
    priority: item.priority === 'low' || item.priority === 'medium' ? item.priority : 'high',
    source: candidate.source,
    action_type: candidate.action_type,
    page_type: candidate.page_type,
    execution_path: candidate.execution_path,
    suggested_title: cleanString(item.suggested_title) || buildTitle(candidate.keyword, candidate.page_type),
    suggested_slug: cleanString(item.suggested_slug) || buildSlug(candidate.keyword),
    why_now: cleanString(item.why_now) || buildWhyNow(candidate),
    business_fit: cleanString(item.business_fit) || buildBusinessFit(candidate),
    recommended_mode: candidate.execution_path === 'blog_now' ? 'seo_only' : 'unified',
    score: candidate.score,
  }
}

function buildFallbackOutput(input: SeoAgentInput, limit: number): SeoAgentOutput {
  const top_opportunities: SeoOpportunity[] = input.candidates.slice(0, limit).map((candidate, index) => ({
    keyword: candidate.keyword,
    priority: index < 2 ? 'high' : 'medium',
    source: candidate.source,
    action_type: candidate.action_type,
    page_type: candidate.page_type,
    execution_path: candidate.execution_path,
    suggested_title: buildTitle(candidate.keyword, candidate.page_type),
    suggested_slug: buildSlug(candidate.keyword),
    why_now: buildWhyNow(candidate),
    business_fit: buildBusinessFit(candidate),
    recommended_mode: candidate.execution_path === 'blog_now' ? 'seo_only' : 'unified',
    score: candidate.score,
  }))

  return {
    summary: fallbackSummary(top_opportunities),
    top_opportunities,
    skipped_keywords: [],
  }
}

function fallbackSummary(items: SeoOpportunity[]): string {
  const moneyPages = items.filter((item) => item.execution_path === 'manual_page_brief').length
  const blogItems = items.filter((item) => item.execution_path === 'blog_now').length
  const refreshes = items.filter((item) => item.execution_path === 'page_upgrade').length
  return `Current SEO focus: ${moneyPages} money page opportunities, ${blogItems} support content opportunities, and ${refreshes} existing-page refresh opportunities.`
}

function buildTitle(keyword: string, pageType: SeoOpportunity['page_type']): string {
  if (pageType === 'comparison_article') return `${toTitleCase(keyword)} Comparison Guide`
  if (pageType === 'guide_article') return `${toTitleCase(keyword)} Guide`
  return toTitleCase(keyword)
}

function buildSlug(keyword: string): string {
  return keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

function buildWhyNow(item: SeoAgentInput['candidates'][number]): string {
  if (item.source === 'gap') return 'Competitors already rank here while the client still has no direct page targeting this demand.'
  if (item.source === 'position_change') return 'The client has already lost ground on this keyword, so recovering the page is faster than starting from zero.'
  return 'The client already has some ranking signal here, which makes this a realistic near-term uplift opportunity.'
}

function buildBusinessFit(item: SeoAgentInput['candidates'][number]): string {
  if (item.action_type === 'create_money_page') return 'Commercial search intent suggests this keyword can support direct enquiries or sales-oriented landing pages.'
  if (item.action_type === 'refresh_existing_page') return 'This keyword already maps to an existing page footprint, so an upgrade path is more efficient than a net-new asset.'
  return 'This keyword works best as support content that strengthens topical authority and links back into money pages.'
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toTitleCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
