/**
 * SEO Gap Analyzer
 *
 * Ingests parsed keyword data, scores opportunities, detects clusters,
 * and calls Claude for narrative intelligence + strategic recommendations.
 *
 * Output is a structured SeoGapAnalysis object used by docx-generator.ts.
 */

import { calculateOpportunityScore } from '@/lib/scoring/opportunity-score'
import { callClaudeWithDocs, parseJsonResponse } from '@/lib/anthropic/client'
import { filterB2cKeywords } from './csv-parser'
import type { ParsedKeyword } from './csv-parser'
import type { KeywordIntent } from '@/types/magic-engine'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RankedKeyword extends ParsedKeyword {
  opportunity_score: number
  tier: 'A' | 'B' | 'C'
}

export interface KeywordCluster {
  name: string
  theme: string
  keywords: RankedKeyword[]
  total_volume: number
  avg_kd: number
}

export interface AiInsights {
  executive_summary: string
  market_opportunity: string
  top_clusters: Array<{
    name: string
    why_priority: string
    recommended_action: string
  }>
  competitor_intelligence: string
  action_roadmap: {
    days_30: string[]
    days_60: string[]
    days_90: string[]
  }
  suburb_page_opportunities: string[]
  b2c_brand_pages: string[]
}

export interface SeoGapAnalysis {
  client_domain: string
  competitors: string[]
  total_keywords_raw: number
  total_keywords_b2c: number
  tier_a: RankedKeyword[]   // Immediate action: high volume, low KD
  tier_b: RankedKeyword[]   // Blog content: medium volume / difficulty
  tier_c: RankedKeyword[]   // Programmatic suburb pages
  clusters: KeywordCluster[]
  ai_insights: AiInsights
  cost_usd: number
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function analyzeSeoGap(params: {
  rawKeywords: ParsedKeyword[]
  competitors: string[]
  clientDomain: string
  clientName: string
  industry?: string
}): Promise<SeoGapAnalysis> {
  const { rawKeywords, competitors, clientDomain, clientName, industry = 'flooring & bathware retail' } = params

  // 1. B2C filter
  const b2cKeywords = filterB2cKeywords(rawKeywords)

  // 2. Score and tier every keyword
  const ranked = b2cKeywords.map(kw => scoreKeyword(kw))

  // 3. Sort by opportunity score desc
  ranked.sort((a, b) => b.opportunity_score - a.opportunity_score)

  // 4. Assign tiers
  const tierA = ranked.filter(k => k.tier === 'A').slice(0, 30)
  const tierB = ranked.filter(k => k.tier === 'B').slice(0, 50)
  const tierC = ranked.filter(k => k.tier === 'C').slice(0, 100)

  // 5. Cluster detection
  const clusters = detectClusters(tierA.concat(tierB))

  // 6. Claude AI insights
  const topKeywordsForClaude = ranked.slice(0, 80)
  const { insights, cost_usd } = await callClaudeForInsights({
    keywords: topKeywordsForClaude,
    competitors,
    clientDomain,
    clientName,
    industry,
    clusters,
  })

  return {
    client_domain: clientDomain,
    competitors,
    total_keywords_raw: rawKeywords.length,
    total_keywords_b2c: b2cKeywords.length,
    tier_a: tierA,
    tier_b: tierB,
    tier_c: tierC,
    clusters,
    ai_insights: insights,
    cost_usd,
  }
}

// ─── Scoring and tiering ──────────────────────────────────────────────────────

function scoreKeyword(kw: ParsedKeyword): RankedKeyword {
  const score = calculateOpportunityScore({
    volume: kw.volume,
    kd: kw.kd === -1 ? 0 : kw.kd,  // -1 means near-zero difficulty
    cpc: kw.cpc,
    intent: kw.intent as KeywordIntent,
    isGap: true,
  })

  let tier: 'A' | 'B' | 'C'
  const effectiveKd = kw.kd === -1 ? 0 : kw.kd

  if (kw.volume >= 200 && effectiveKd <= 20) {
    tier = 'A'
  } else if (kw.volume >= 50 && effectiveKd <= 35) {
    tier = 'B'
  } else {
    tier = 'C'
  }

  return { ...kw, opportunity_score: score, tier }
}

// ─── Cluster detection ────────────────────────────────────────────────────────

const CLUSTER_SEEDS: Array<{ name: string; theme: string; patterns: string[] }> = [
  {
    name: 'Blackbutt Timber Flooring',
    theme: 'Premium Australian hardwood — ultra-low KD, 5,600+/mo total volume',
    patterns: ['blackbutt'],
  },
  {
    name: 'Vinyl Plank Flooring',
    theme: 'High-volume DIY/reno category with commercial & residential intent',
    patterns: ['vinyl plank', 'lvt', 'luxury vinyl'],
  },
  {
    name: 'Hybrid Flooring',
    theme: 'Fast-growing category — price comparisons and brand searches',
    patterns: ['hybrid floor'],
  },
  {
    name: 'Bathroom Tiles & Tapware',
    theme: 'Tiles + tapware cross-sell — Oztop already has Caroma rankings as a base',
    patterns: ['tile', 'tapware', 'bathroom tap', 'basin mixer', 'shower tap', 'caroma'],
  },
  {
    name: 'Engineered Timber',
    theme: 'Aspirational upgrade category; informational intent, brand pages viable',
    patterns: ['engineered timber', 'engineered hardwood', 'engineered wood floor'],
  },
  {
    name: 'Laminate Flooring',
    theme: 'Budget-conscious buyers — heavy suburb-page opportunity',
    patterns: ['laminate floor'],
  },
  {
    name: 'Carpet & Rugs',
    theme: 'Broad volume category; carpet brands and suburb location pages',
    patterns: ['carpet', 'rug', 'wool floor'],
  },
  {
    name: 'DIY Flooring & Installation',
    theme: 'How-to content funnel — pulls upper-funnel traffic into the store',
    patterns: ['how to', 'diy', 'install', 'laying'],
  },
]

function detectClusters(keywords: RankedKeyword[]): KeywordCluster[] {
  const clusters: KeywordCluster[] = []

  for (const seed of CLUSTER_SEEDS) {
    const matched = keywords.filter(kw =>
      seed.patterns.some(pattern => kw.keyword.toLowerCase().includes(pattern))
    )

    if (matched.length === 0) continue

    const totalVol = matched.reduce((sum, k) => sum + k.volume, 0)
    const avgKd = matched.length > 0
      ? Math.round(matched.reduce((sum, k) => sum + (k.kd === -1 ? 0 : k.kd), 0) / matched.length)
      : 0

    clusters.push({
      name: seed.name,
      theme: seed.theme,
      keywords: matched.sort((a, b) => b.volume - a.volume),
      total_volume: totalVol,
      avg_kd: avgKd,
    })
  }

  // Sort clusters by total volume desc
  return clusters.sort((a, b) => b.total_volume - a.total_volume)
}

// ─── Claude AI call ───────────────────────────────────────────────────────────

async function callClaudeForInsights(params: {
  keywords: RankedKeyword[]
  competitors: string[]
  clientDomain: string
  clientName: string
  industry: string
  clusters: KeywordCluster[]
}): Promise<{ insights: AiInsights; cost_usd: number }> {
  const { keywords, competitors, clientDomain, clientName, industry, clusters } = params

  const kwTable = keywords.slice(0, 60)
    .map(k => `${k.keyword} | Vol:${k.volume} | KD:${k.kd === -1 ? '~0' : k.kd} | Intent:${k.intent} | Competitors:${k.competitors.slice(0, 3).join(',')}`)
    .join('\n')

  const clusterSummary = clusters
    .map(c => `${c.name}: ${c.keywords.length} keywords, total vol ${c.total_volume}, avg KD ${c.avg_kd}`)
    .join('\n')

  const systemPrompt = `You are an expert SEO strategist for Australian B2C retail, specialising in ${industry}.
Your analysis is grounded in SEMrush keyword gap data. Respond ONLY with valid JSON — no markdown fences.`

  const userMessage = `
Client: ${clientName} (${clientDomain})
Industry: ${industry}
Competitors analysed: ${competitors.slice(0, 10).join(', ')}

TOP KEYWORD GAP OPPORTUNITIES (B2C only — trade/commercial excluded):
${kwTable}

DETECTED KEYWORD CLUSTERS:
${clusterSummary}

Produce a strategic SEO analysis. Output valid JSON matching this schema exactly:
{
  "executive_summary": "2-3 sentence overview of the biggest opportunity",
  "market_opportunity": "1 paragraph on market context and what the gap data reveals",
  "top_clusters": [
    {
      "name": "cluster name",
      "why_priority": "why this cluster should be actioned first",
      "recommended_action": "specific page type / content format to create"
    }
  ],
  "competitor_intelligence": "1 paragraph on which competitors dominate which areas and why",
  "action_roadmap": {
    "days_30": ["specific action 1", "specific action 2", "specific action 3"],
    "days_60": ["specific action 1", "specific action 2"],
    "days_90": ["specific action 1", "specific action 2"]
  },
  "suburb_page_opportunities": ["suburb1 flooring", "suburb2 tiles", "suburb3 bathroom"],
  "b2c_brand_pages": ["brand keyword 1", "brand keyword 2", "brand keyword 3"]
}
`

  const result = await callClaudeWithDocs({
    systemPrompt,
    userMessage,
    maxOutputTokens: 4096,
  })

  const insights = parseJsonResponse<AiInsights>(result.text)

  return { insights, cost_usd: result.cost_usd }
}
