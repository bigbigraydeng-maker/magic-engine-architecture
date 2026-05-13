import { getDomainMetrics, getDomainOrganicKeywords } from '@/lib/semrush/client'
import type { DomainMetrics } from '@/lib/semrush/client'
import type { CollectorResult, NewFinding } from '../types'
import { MAX_COLLECTOR_TIMEOUT_MS } from '../constants'

// NewFinding is imported above; the helper makes a finding inline.

const KW_COVERAGE_WEIGHT = 70
const AUTHORITY_WEIGHT = 30
const LOW_AUTHORITY_THRESHOLD = 20
const ORGANIC_KW_LIMIT = 200

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
      return await Promise.race([
        this.fetchAndScore(clientId, clientDomain, keywords),
        timeout,
      ])
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

    const [metrics, rankedKwData] = await Promise.all([
      getDomainMetrics(domain),
      getDomainOrganicKeywords(domain, db, ORGANIC_KW_LIMIT),
    ])

    const rankedSet = new Set(rankedKwData.map(k => k.keyword.toLowerCase()))
    const matched = keywords.filter(k => rankedSet.has(k.toLowerCase())).length
    const total = keywords.length
    const coverageRatio = matched / total

    return this.buildResult(clientId, metrics, coverageRatio, total, matched)
  }

  private makeKeywordsNotConfiguredFinding(clientId: string): NewFinding {
    return {
      client_id: clientId,
      dimension: 'seo',
      finding_type: 'keywords_not_configured',
      severity: 'high',
      title: 'Target keywords not configured',
      description:
        'No target keywords are configured for this client, so SEO performance cannot be measured. Add 10–20 priority keywords (mix of brand, category, and long-tail) to enable visibility tracking.',
      evidence: { configured_keywords: 0 },
      recommendation:
        'Open Client Settings → SEO Keywords and add 10–20 keywords prioritising local intent ("flooring brisbane", "vinyl flooring qld"). Re-run diagnostic afterwards.',
      fix_type: 'fde_manual',
      priority_score: 90,
    }
  }

  private buildResult(
    clientId: string,
    metrics: DomainMetrics,
    coverageRatio: number,
    total: number,
    matched: number,
  ): CollectorResult {
    const authority = Math.min(100, Math.max(0, metrics.authority_score))
    const raw = coverageRatio * KW_COVERAGE_WEIGHT + (authority / 100) * AUTHORITY_WEIGHT
    const score = Math.min(100, Math.max(0, Math.round(raw)))

    const findings: NewFinding[] = []

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

    if (metrics.authority_score < LOW_AUTHORITY_THRESHOLD) {
      findings.push({
        client_id: clientId,
        dimension: 'seo',
        finding_type: 'low_domain_rank',
        severity: 'high',
        title: 'Low domain authority score',
        description:
          `Domain authority is ${metrics.authority_score}/100 — below the healthy threshold of ${LOW_AUTHORITY_THRESHOLD}.`,
        evidence: { authority_score: metrics.authority_score },
        recommendation: 'Build quality backlinks through digital PR and content partnerships.',
        fix_type: 'fde_manual',
        priority_score: 75,
      })
    }

    return { score, findings }
  }
}
