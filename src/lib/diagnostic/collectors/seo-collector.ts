import { getDomainMetrics, getDomainOrganicKeywords } from '@/lib/semrush/client'
import type { DomainMetrics } from '@/lib/semrush/client'
import { auditTechnicalSeo } from '@/lib/diagnostic/technical-seo'
import type { TechnicalSeoSignals } from '@/lib/diagnostic/technical-seo'
import type { CollectorResult, NewFinding } from '../types'
import { MAX_COLLECTOR_TIMEOUT_MS } from '../constants'

// ─── Scoring weights (must sum to 100) ───────────────────────────────────────
const KW_COVERAGE_WEIGHT  = 50   // was 70; reduced to make room for technical
const AUTHORITY_WEIGHT    = 25   // was 30
const TECHNICAL_WEIGHT    = 25   // new: Jina homepage audit signals
const LOW_AUTHORITY_THRESHOLD = 20
const ORGANIC_KW_LIMIT    = 200

export class SeoCollector {
  private readonly timeoutMs: number

  constructor(timeoutMs: number = MAX_COLLECTOR_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs
  }

  async collect(
    clientId: string,
    clientDomain: string,
    keywords: string[],
  ): Promise<CollectorResult> {
    // P8.5.19: no target keywords configured → score is unknowable, not "perfect"
    if (keywords.length === 0) {
      return {
        score: null,
        findings: [this.makeKeywordsNotConfiguredFinding(clientId)],
      }
    }

    const fallback: CollectorResult = { score: null, findings: [] }
    const timeout = new Promise<CollectorResult>(resolve =>
      setTimeout(() => resolve(fallback), this.timeoutMs),
    )

    try {
      return await Promise.race([this.fetchAndScore(clientId, clientDomain, keywords), timeout])
    } catch {
      return fallback
    }
  }

  private async fetchAndScore(
    clientId: string,
    domain: string,
    keywords: string[],
  ): Promise<CollectorResult> {
    const db = process.env.SEMRUSH_DB ?? 'au'

    const [metrics, rankedKwData, technical] = await Promise.all([
      getDomainMetrics(domain),
      getDomainOrganicKeywords(domain, db, ORGANIC_KW_LIMIT),
      auditTechnicalSeo(domain),
    ])

    const rankedSet = new Set(rankedKwData.map(k => k.keyword.toLowerCase()))
    const matched = keywords.filter(k => rankedSet.has(k.toLowerCase())).length
    const total = keywords.length
    const coverageRatio = matched / total

    return this.buildResult(clientId, metrics, coverageRatio, total, matched, technical)
  }

  private buildResult(
    clientId: string,
    metrics: DomainMetrics,
    coverageRatio: number,
    total: number,
    matched: number,
    technical: TechnicalSeoSignals,
  ): CollectorResult {
    const authority = Math.min(100, Math.max(0, metrics.authority_score))
    const raw =
      coverageRatio * KW_COVERAGE_WEIGHT +
      (authority / 100) * AUTHORITY_WEIGHT +
      (technical.score / 100) * TECHNICAL_WEIGHT
    const score = Math.min(100, Math.max(0, Math.round(raw)))

    const findings: NewFinding[] = []

    // ── Keyword findings ──────────────────────────────────────────────────────
    if (total > 0 && coverageRatio === 0) {
      findings.push({
        client_id: clientId,
        dimension: 'seo',
        finding_type: 'keyword_gap_critical',
        severity: 'critical',
        title: 'No target keywords found in organic rankings',
        description: `None of the ${total} target keywords appear in the top ${ORGANIC_KW_LIMIT} organic rankings.`,
        evidence: { total_keywords: total, matched_keywords: matched },
        recommendation: 'Create targeted content for each keyword and build topical authority.',
        fix_type: 'fde_manual',
        priority_score: 95,
      })
    }

    // ── Authority finding ─────────────────────────────────────────────────────
    if (metrics.authority_score < LOW_AUTHORITY_THRESHOLD) {
      findings.push({
        client_id: clientId,
        dimension: 'seo',
        finding_type: 'low_domain_rank',
        severity: 'high',
        title: 'Low domain authority score',
        description: `Domain authority is ${metrics.authority_score}/100 — below the healthy threshold of ${LOW_AUTHORITY_THRESHOLD}.`,
        evidence: { authority_score: metrics.authority_score },
        recommendation: 'Build quality backlinks through digital PR and content partnerships.',
        fix_type: 'fde_manual',
        priority_score: 75,
      })
    }

    // ── Technical findings ────────────────────────────────────────────────────
    for (const issue of technical.issues) {
      const f = this.makeTechnicalFinding(clientId, issue)
      if (f) findings.push(f)
    }

    return { score, findings }
  }

  private makeTechnicalFinding(clientId: string, issue: TechnicalSeoSignals['issues'][number]): NewFinding | null {
    const base = { client_id: clientId, dimension: 'seo' as const, fix_type: 'fde_manual' as const }
    switch (issue) {
      case 'missing_meta_title':
        return { ...base, finding_type: 'missing_meta_title', severity: 'high', title: 'Page title is missing', description: 'The homepage has no <title> tag. This is a critical SEO signal for search engines and appears in search result snippets.', evidence: null, recommendation: 'Add a descriptive title tag (50–70 characters) including the primary keyword and brand name.', priority_score: 80 }
      case 'short_meta_title':
        // finding_type reuses 'missing_meta_title' (no separate type in schema);
        // distinguished by evidence.subtype for downstream filtering.
        return { ...base, finding_type: 'missing_meta_title', severity: 'medium', title: 'Page title length is not optimal', description: 'The homepage title is outside the ideal 30–70 character range for search snippet display.', evidence: { subtype: 'short_meta_title' }, recommendation: 'Revise the title to be 50–70 characters, leading with the primary keyword.', priority_score: 45 }
      case 'missing_h1':
        return { ...base, finding_type: 'missing_h1', severity: 'high', title: 'Homepage missing H1 heading', description: 'No H1 heading found on the homepage. H1 is a primary on-page SEO signal and helps search engines understand page topic.', evidence: { subtype: 'missing_h1' }, recommendation: 'Add a single H1 tag to the homepage that includes the primary keyword.', priority_score: 72 }
      case 'multiple_h1':
        // finding_type reuses 'missing_h1' (H1 is not correct); subtype distinguishes.
        return { ...base, finding_type: 'missing_h1', severity: 'medium', title: 'Multiple H1 headings detected', description: 'More than one H1 tag found on the homepage. Each page should have exactly one H1 to clearly signal the primary topic.', evidence: { subtype: 'multiple_h1' }, recommendation: 'Consolidate to a single H1 tag; demote secondary headings to H2/H3.', priority_score: 40 }
      case 'thin_content':
        return { ...base, finding_type: 'thin_content', severity: 'medium', title: 'Homepage has thin content', description: 'The homepage contains fewer than 300 words of content. Thin pages rank poorly and provide little value to visitors.', evidence: null, recommendation: 'Expand the homepage with service descriptions, value propositions, and local context (at least 400–600 words).', priority_score: 55 }
      case 'few_internal_links':
        return { ...base, finding_type: 'broken_internal_links', severity: 'low', title: 'Few internal links on homepage', description: 'Fewer than 5 internal links detected on the homepage, limiting link equity flow to key pages.', evidence: null, recommendation: 'Add contextual internal links to main category and service pages.', priority_score: 30 }
      default:
        return null
    }
  }

  private makeKeywordsNotConfiguredFinding(clientId: string): NewFinding {
    return {
      client_id: clientId,
      dimension: 'seo',
      finding_type: 'keywords_not_configured',
      severity: 'high',
      title: 'Target keywords not configured',
      description: 'No target keywords are configured for this client, so SEO performance cannot be measured. Add 10–20 priority keywords (mix of brand, category, and long-tail) to enable visibility tracking.',
      evidence: { configured_keywords: 0 },
      recommendation: 'Open Client Settings → SEO Keywords and add 10–20 keywords prioritising local intent ("flooring brisbane", "vinyl flooring qld"). Re-run diagnostic afterwards.',
      fix_type: 'fde_manual',
      priority_score: 90,
    }
  }
}
