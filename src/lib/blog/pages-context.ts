/**
 * pages-context.ts
 *
 * Fetches client_site_pages whose topics overlap with a blog topic,
 * then formats them as a GPT-4o prompt context block so the generator
 * writes from a different angle rather than duplicating existing content.
 *
 * Phase 8.2.1
 */

import { supabaseAdmin } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RelatedPageSummary {
  id: string
  url: string
  title: string | null
  page_type: string
  word_count: number | null
  topics: string[]
  primary_keyword: string | null
  has_geo_block: boolean
}

// ---------------------------------------------------------------------------
// fetchRelatedPages
// ---------------------------------------------------------------------------

/**
 * Returns pages from client_site_pages whose topics or primary_keyword
 * overlap with the given blog topic.
 *
 * - Words shorter than 4 chars are skipped (stop words like "the", "nz")
 * - Results are sorted by word_count DESC (most comprehensive first)
 * - Limited to `limit` pages (default 5)
 */
export async function fetchRelatedPages(
  clientId: string,
  topic: string,
  limit = 5
): Promise<RelatedPageSummary[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('client_site_pages')
      .select('id, url, title, page_type, word_count, topics, primary_keyword, has_geo_block')
      .eq('client_id', clientId)

    if (error || !data) return []

    const topicWords = extractWords(topic)
    if (topicWords.length === 0) return []

    const matched = (data as RelatedPageSummary[]).filter(page =>
      hasTopicOverlap(page, topicWords)
    )

    matched.sort((a, b) => (b.word_count ?? 0) - (a.word_count ?? 0))

    return matched.slice(0, limit)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// buildPagesContextBlock
// ---------------------------------------------------------------------------

/**
 * Formats related pages as a prompt section with two distinct directives:
 *
 *   1. INTERNAL LINK OPPORTUNITIES — instructs Claude to weave real <a href>
 *      links into the body using the exact URLs from client_site_pages.
 *      This is the primary SEO signal that differentiates ME-generated content
 *      from generic AI output (rule 8 in the blog generator system prompt).
 *
 *   2. SIMILAR TOPIC PAGES — same page list framed as "write from a different
 *      angle" to prevent duplicate-content issues across the site.
 *
 * Returns empty string when there are no pages (safe to concat).
 */
export function buildPagesContextBlock(pages: RelatedPageSummary[]): string {
  if (pages.length === 0) return ''

  const formatted = pages.map((page, i) => {
    const title = page.title ?? hostname(page.url)
    const wordInfo = page.word_count != null
      ? `${page.word_count.toLocaleString()} words`
      : 'unknown length'
    return `${i + 1}. "${title}" (${page.url}) — ${page.page_type}, ${wordInfo}`
  })

  const linkSection = [
    'INTERNAL LINK OPPORTUNITIES — weave 3–5 of these into the body as <a href="FULL_URL">keyword-rich anchor text</a>:',
    ...formatted,
  ].join('\n')

  const similarSection = [
    'EXISTING CONTENT ON SIMILAR TOPICS — write from a DIFFERENT angle, do NOT duplicate:',
    ...formatted,
  ].join('\n')

  return `${linkSection}\n\n${similarSection}`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4)
}

function hasTopicOverlap(page: RelatedPageSummary, topicWords: string[]): boolean {
  const pageText = [
    ...(page.topics ?? []),
    page.primary_keyword ?? '',
  ]
    .join(' ')
    .toLowerCase()

  return topicWords.some(word => pageText.includes(word))
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
