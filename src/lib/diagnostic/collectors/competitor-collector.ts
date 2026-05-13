import { getDomainMetrics } from '@/lib/semrush/client'
import { getCompetitorDomains } from '@/lib/dataforseo/client'
import type { CompetitorDomain } from '@/lib/dataforseo/client'
import { scrapeCompetitorMetaAds } from '@/lib/apify/ad-library'
import type { MetaAdData } from '@/lib/apify/ad-library'
import type { CollectorResult, NewFinding } from '../types'

// ---------------------------------------------------------------------------
// Extended return type
// ---------------------------------------------------------------------------

export interface CompetitorEntry extends CompetitorDomain {
  meta_ads?: MetaAdData
}

export interface CompetitorCollectorResult extends CollectorResult {
  competitorList: CompetitorEntry[]
}

// ---------------------------------------------------------------------------
// CompetitorCollector
// ---------------------------------------------------------------------------

export class CompetitorCollector {
  async collect(
    clientId: string,
    domain: string,
    _keywords: string[],
  ): Promise<CompetitorCollectorResult> {
    // 1. Get competitor domains from DataForSEO
    let competitors: CompetitorDomain[]
    try {
      competitors = await getCompetitorDomains(domain, 5)
    } catch {
      competitors = []
    }

    // P8.5.21: insufficient competitor data → score is unknowable, not "average"
    if (competitors.length < 3) {
      return {
        score: null,
        findings: [this.makeCompetitorDataInsufficientFinding(clientId, competitors.length)],
        competitorList: competitors as CompetitorEntry[],
      }
    }

    // 2. Fetch SEMrush domain_ranks for client + all competitors concurrently
    const allDomains = [domain, ...competitors.map(c => c.domain)]
    const metricsResults = await Promise.allSettled(
      allDomains.map(d => getDomainMetrics(d)),
    )

    const clientMetrics =
      metricsResults[0].status === 'fulfilled' ? metricsResults[0].value : null

    const competitorList: CompetitorEntry[] = competitors
      .map((comp, i) => {
        const settled = metricsResults[i + 1]
        const traffic =
          settled.status === 'fulfilled'
            ? settled.value.organic_traffic
            : comp.organic_traffic
        const authorityScore =
          settled.status === 'fulfilled'
            ? settled.value.authority_score
            : comp.authority_score
        return { ...comp, organic_traffic: traffic, authority_score: authorityScore }
      })
      .sort((a, b) => b.overlap_score - a.overlap_score)

    // 3. Scrape Meta Ads for top 3 competitors — serial to respect rate limits
    const top3 = competitorList.slice(0, 3)
    for (const comp of top3) {
      try {
        comp.meta_ads = await scrapeCompetitorMetaAds(comp.domain)
      } catch {
        // non-fatal: proceed without ad data for this competitor
      }
    }

    // 4. Compute score
    const clientTraffic = clientMetrics?.organic_traffic ?? 0
    const avgCompetitorTraffic =
      competitorList.reduce((sum, c) => sum + c.organic_traffic, 0) / competitorList.length

    const ratio = avgCompetitorTraffic > 0 ? clientTraffic / avgCompetitorTraffic : 1
    const score = Math.min(100, Math.round(ratio * 100))

    // 5. Generate findings
    const findings: NewFinding[] = []

    if (ratio < 0.1) {
      findings.push({
        client_id: clientId,
        dimension: 'competitor',
        finding_type: 'traffic_gap_large',
        severity: 'critical',
        title: 'Large Organic Traffic Gap vs Competitors',
        description: `Your organic traffic is only ${Math.round(ratio * 100)}% of the average competitor traffic. This represents a significant competitive disadvantage.`,
        evidence: {
          client_traffic: clientTraffic,
          avg_competitor_traffic: Math.round(avgCompetitorTraffic),
          ratio: Math.round(ratio * 1000) / 1000,
          top_competitors: competitorList.slice(0, 3).map(c => ({
            domain: c.domain,
            traffic: c.organic_traffic,
          })),
        },
        recommendation:
          'Invest in content marketing and SEO to close the traffic gap. Focus on high-intent keywords where competitors rank but you do not.',
        fix_type: 'fde_manual',
        priority_score: 90,
      })
    }

    return { score, findings, competitorList }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private makeCompetitorDataInsufficientFinding(
    clientId: string,
    found: number,
  ): NewFinding {
    return {
      client_id: clientId,
      dimension: 'competitor',
      finding_type: 'competitor_data_insufficient',
      severity: 'high',
      title:
        found === 0
          ? 'No organic competitors detected'
          : `Only ${found} organic competitor${found === 1 ? '' : 's'} detected (minimum 3 required)`,
      description:
        found === 0
          ? 'DataForSEO returned zero competitor domains. The domain likely has no organic keyword rankings yet, so the competitive landscape cannot be measured.'
          : `Only ${found} competitor domain${found === 1 ? '' : 's'} found — not enough signal to score the competitive landscape (minimum 3 needed for meaningful comparison).`,
      evidence: { competitors_found: found, competitors_required: 3 },
      recommendation:
        found === 0
          ? 'Get the site indexed and earn organic keyword rankings first (see SEO dimension). Re-run competitor analysis once any keywords rank in top 100.'
          : 'Run SEMrush competitive research manually to identify a broader competitive set; supplement with industry-known competitors via Client Settings → Competitors.',
      fix_type: found === 0 ? 'fde_manual' : 'me_auto',
      priority_score: found === 0 ? 70 : 50,
    }
  }
}
