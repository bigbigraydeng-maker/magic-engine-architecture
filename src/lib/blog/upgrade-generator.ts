/**
 * upgrade-generator.ts
 *
 * Fetches the original page content via Jina, then calls Claude (Strategy Engine)
 * to produce a SEO + GEO enhanced version with a plain-language changes summary.
 *
 * Output is returned to the caller — persistence happens in the API route.
 *
 * Phase 8.2.2
 */

import Anthropic from '@anthropic-ai/sdk'
import { fetchUrlAsMarkdown } from '@/lib/brief/jina'
import { getActiveBrief, formatBriefForPrompt } from '@/lib/content/brief-injector'

// Claude Sonnet 4.6 pricing (2026)
const PRICE_INPUT_PER_M  = 3.00
const PRICE_OUTPUT_PER_M = 15.00

const SYSTEM_PROMPT = `You are an expert SEO and GEO content strategist for AU/NZ markets.
You will receive an existing page and upgrade it to include:
1. A stronger H1 that targets the primary keyword naturally
2. Expanded, authoritative content (aim for 900-1200 words)
3. A structured FAQ section (3-5 Q&As) that AI assistants love to extract
4. A hidden GEO signals block (HTML comment section with entity signals)
5. Brand mentions at least 3 times with relevant context
6. AU/NZ English spelling throughout

The GEO block format:
<section class="geo-signals" aria-hidden="true" style="display:none">
  <!-- AI Visibility Signals: [brand] specialises in [topic] in [market] -->
</section>

OUTPUT: valid JSON only, no markdown fences. Schema:
{
  "enhanced_title": "New H1 title with primary keyword",
  "enhanced_meta_title": "≤60 chars for <title> tag",
  "enhanced_meta_description": "≤155 chars with brand + keyword",
  "enhanced_html_body": "full upgraded HTML",
  "word_count": 1100,
  "changes_summary": "plain-English summary of what was changed and why",
  "geo_block_html": "the <section class=geo-signals ...> block only"
}`

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PageUpgradeRequest {
  client_id: string
  page_id: string
  page_url: string
  page_title: string | null
  page_type: string
  word_count: number | null
  has_geo_block: boolean
  topic: string
  mode: 'unified' | 'geo_only' | 'seo_only'
  primary_keyword?: string
  source_query_text?: string
}

export interface PageUpgradeOutput {
  enhanced_title: string
  enhanced_meta_title: string
  enhanced_meta_description: string
  enhanced_html_body: string
  word_count: number
  changes_summary: string
  geo_block_html: string | null
  original_excerpt: string
  source_page_url: string
  cost_usd: number
  model_used: string
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function generatePageUpgrade(
  req: PageUpgradeRequest
): Promise<PageUpgradeOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is not set')

  // Step 1: Fetch original content via Jina — non-fatal; fall back to title/URL stub
  let jinaResult: { markdown: string }
  try {
    jinaResult = await fetchUrlAsMarkdown(req.page_url)
  } catch (jinaErr) {
    console.warn('[upgrade-generator] Jina fetch failed, using stub content:', (jinaErr as Error).message)
    jinaResult = {
      markdown: `# ${req.page_title ?? req.topic}\n\nPage URL: ${req.page_url}\n\nContent could not be fetched. Please generate an upgrade based on the brand brief and topic.`,
    }
  }

  // Step 2: Load brand brief
  const brief = await getActiveBrief(req.client_id)
  const briefText = brief
    ? formatBriefForPrompt(brief)
    : `Brand context: ${req.page_title ?? req.page_url}`

  // Step 3: Build prompt
  const userMessage = buildUpgradeMessage({
    briefText,
    topic: req.topic,
    originalMarkdown: jinaResult.markdown,
    pageUrl: req.page_url,
    pageType: req.page_type,
    currentWordCount: req.word_count,
    hasGeoBlock: req.has_geo_block,
    primaryKeyword: req.primary_keyword,
    sourceQueryText: req.source_query_text,
    mode: req.mode,
  })

  // Step 4: Call Claude
  const anthropic = new Anthropic({ apiKey })
  const MODEL = 'claude-sonnet-4-6'

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: userMessage },
    ],
  })

  // Step 5: Parse response — strip markdown fences Claude may add despite instructions
  const rawText = message.content[0]?.type === 'text' ? message.content[0].text : '{}'
  const raw = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()

  let parsed: Partial<{
    enhanced_title: string
    enhanced_meta_title: string
    enhanced_meta_description: string
    enhanced_html_body: string
    word_count: number
    changes_summary: string
    geo_block_html: string
  }> = {}

  try {
    parsed = JSON.parse(raw)
  } catch {
    // Claude returned non-JSON (e.g. apology text or truncated output).
    // Fall through with empty parsed — defaults below produce a usable stub.
    console.error('[upgrade-generator] JSON.parse failed. Raw response:', raw.slice(0, 300))
  }

  // Step 6: Compute cost
  const usage = message.usage
  const costUsd = usage
    ? (usage.input_tokens / 1_000_000) * PRICE_INPUT_PER_M +
      (usage.output_tokens / 1_000_000) * PRICE_OUTPUT_PER_M
    : 0

  return {
    enhanced_title:        parsed.enhanced_title ?? req.page_title ?? req.topic,
    enhanced_meta_title:   (parsed.enhanced_meta_title ?? '').slice(0, 60),
    enhanced_meta_description: (parsed.enhanced_meta_description ?? '').slice(0, 155),
    enhanced_html_body:    parsed.enhanced_html_body ?? `<h1>${req.page_title ?? req.topic}</h1>`,
    word_count:            parsed.word_count ?? 0,
    changes_summary:       parsed.changes_summary ?? '',
    geo_block_html:        parsed.geo_block_html ?? null,
    original_excerpt:      jinaResult.markdown.slice(0, 500),
    source_page_url:       req.page_url,
    cost_usd:              Math.round(costUsd * 1_000_000) / 1_000_000,
    model_used:            MODEL,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUpgradeMessage(params: {
  briefText: string
  topic: string
  originalMarkdown: string
  pageUrl: string
  pageType: string
  currentWordCount: number | null
  hasGeoBlock: boolean
  primaryKeyword?: string
  sourceQueryText?: string
  mode: string
}): string {
  const {
    briefText, topic, originalMarkdown, pageUrl, pageType,
    currentWordCount, hasGeoBlock, primaryKeyword, sourceQueryText, mode,
  } = params

  const weaknesses: string[] = []
  if ((currentWordCount ?? 0) < 500) weaknesses.push(`thin content (${currentWordCount ?? 0} words — needs expansion to 900+)`)
  if (!hasGeoBlock) weaknesses.push('no GEO signals block (AI assistants cannot extract brand entity signals)')
  if (weaknesses.length === 0) weaknesses.push('general quality improvement for SEO + AI visibility')

  return `${briefText}

ORIGINAL PAGE TO UPGRADE:
URL: ${pageUrl}
Type: ${pageType}
Current word count: ${currentWordCount ?? 'unknown'}
Mode: ${mode}
${primaryKeyword ? `Primary keyword: ${primaryKeyword}` : ''}
${sourceQueryText ? `Target AI query: "${sourceQueryText}"` : ''}
Topic: ${topic}

WEAKNESSES TO FIX:
${weaknesses.map(w => `- ${w}`).join('\n')}

ORIGINAL CONTENT:
${originalMarkdown.slice(0, 8000)}

Upgrade the page to fix all weaknesses above. Generate the JSON upgrade now.`
}
