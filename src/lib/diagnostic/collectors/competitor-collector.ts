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

    if (competitors.length === 0) {
      return {
        score: 50,
        findings: [this.makeNoCompetitorDataFinding(clientId)],
        competitorList: [],
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

  private makeNoCompetitorDataFinding(clientId: string): NewFinding {
    return {
      client_id: clientId,
      dimension: 'competitor',
      finding_type: 'no_competitor_data',
      severity: 'info',
      title: 'No Competitor Data Available',
      description:
        'No organic competitors were identified for this domain. This may indicate a very niche market or limited online presence.',
      evidence: null,
      recommendation:
        'Verify the domain is indexed by Google and has organic keyword rankings before running a competitor analysis.',
      fix_type: 'fde_manual',
      priority_score: 30,
    }
  }
}
