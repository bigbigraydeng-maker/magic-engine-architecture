/**
 * Technical SEO signals extracted from a homepage via Jina Reader.
 *
 * Checks that can be done from Jina markdown:
 *   - Page title presence + length
 *   - H1 presence (Jina maps <h1> → `# `)
 *   - Content depth (word count proxy for thin content)
 *   - Internal links (markdown links starting with `/`)
 *
 * Returns a score 0–100 and an array of issue keys for findings.
 */

import { fetchUrlAsMarkdown } from '@/lib/brief/jina'

export interface TechnicalSeoSignals {
  titlePresent: boolean
  titleLength: number
  h1Count: number
  wordCount: number
  internalLinkCount: number
  score: number
  issues: TechnicalSeoIssue[]
}

export type TechnicalSeoIssue =
  | 'missing_meta_title'
  | 'short_meta_title'
  | 'missing_h1'
  | 'multiple_h1'
  | 'thin_content'
  | 'few_internal_links'

const IDEAL_TITLE_MIN = 30
const IDEAL_TITLE_MAX = 70
const MIN_WORDS = 300
const MIN_INTERNAL_LINKS = 5

export async function auditTechnicalSeo(domain: string): Promise<TechnicalSeoSignals> {
  const url = domain.startsWith('http') ? domain : `https://${domain}`

  let title = ''
  let markdown = ''

  try {
    const result = await fetchUrlAsMarkdown(url)
    title = result.title ?? ''
    markdown = result.markdown ?? ''
  } catch {
    // Non-fatal — return a neutral result so SEO scoring still runs
    return neutralSignals()
  }

  const titlePresent = title.trim().length > 0
  const titleLength = title.trim().length

  // Count H1s: Jina maps <h1> to lines starting with exactly "# " (one #)
  const h1Lines = markdown.split('\n').filter(line => /^#\s+\S/.test(line))
  const h1Count = h1Lines.length

  // Word count (rough)
  const wordCount = markdown.split(/\s+/).filter(w => w.length > 2).length

  // Internal links: markdown links like [text](/path) or [text](https://same-domain)
  const hostname = new URL(url).hostname
  const internalLinkRegex = new RegExp(
    `\\[[^\]]+\\]\\((?:/[^)]*|https?://${hostname.replace(/\./g, '\\.')}[^)]*)\\)`,
    'g',
  )
  const internalLinkCount = (markdown.match(internalLinkRegex) ?? []).length

  const issues: TechnicalSeoIssue[] = []
  if (!titlePresent) issues.push('missing_meta_title')
  else if (titleLength < IDEAL_TITLE_MIN || titleLength > IDEAL_TITLE_MAX) issues.push('short_meta_title')
  if (h1Count === 0) issues.push('missing_h1')
  else if (h1Count > 1) issues.push('multiple_h1')
  if (wordCount < MIN_WORDS) issues.push('thin_content')
  if (internalLinkCount < MIN_INTERNAL_LINKS) issues.push('few_internal_links')

  const score = computeTechnicalScore({ titlePresent, titleLength, h1Count, wordCount, internalLinkCount })

  return { titlePresent, titleLength, h1Count, wordCount, internalLinkCount, score, issues }
}

function computeTechnicalScore(s: Omit<TechnicalSeoSignals, 'score' | 'issues'>): number {
  let pts = 0
  // Title: 30 pts
  if (s.titlePresent) {
    pts += s.titleLength >= IDEAL_TITLE_MIN && s.titleLength <= IDEAL_TITLE_MAX ? 30 : 15
  }
  // H1: 25 pts
  if (s.h1Count === 1) pts += 25
  else if (s.h1Count > 1) pts += 10  // present but messy
  // Content depth: 25 pts
  if (s.wordCount >= MIN_WORDS * 2) pts += 25
  else if (s.wordCount >= MIN_WORDS) pts += 15
  else if (s.wordCount > 100) pts += 5
  // Internal links: 20 pts
  if (s.internalLinkCount >= MIN_INTERNAL_LINKS * 3) pts += 20
  else if (s.internalLinkCount >= MIN_INTERNAL_LINKS) pts += 12
  else if (s.internalLinkCount > 0) pts += 5

  return Math.min(100, pts)
}

function neutralSignals(): TechnicalSeoSignals {
  return { titlePresent: false, titleLength: 0, h1Count: 0, wordCount: 0, internalLinkCount: 0, score: 50, issues: [] }
}
