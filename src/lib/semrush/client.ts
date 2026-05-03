// SEMrush API Client
// 封装 4 个核心工具，对内提供统一接口

const SEMRUSH_API_BASE = 'https://api.semrush.com'
const API_KEY = process.env.SEMRUSH_API_KEY!
const DEFAULT_DB = process.env.SEMRUSH_DB || 'au'

export interface SemrushKeywordData {
  keyword: string
  volume: number
  kd: number
  cpc: number
  intent: string
  trend: { month: string; volume: number }[]
}

// Tool 1: 批量关键词概览（最多100个）
export async function batchKeywordOverview(
  keywords: string[],
  db: string = DEFAULT_DB
): Promise<SemrushKeywordData[]> {
  const params = new URLSearchParams({
    type: 'phrase_these',
    key: API_KEY,
    phrase: keywords.join(';'),
    database: db,
    export_columns: 'Ph,Nq,Kd,Cp,In,Tr',
    display_limit: String(keywords.length),
  })

  const res = await fetch(`${SEMRUSH_API_BASE}/?${params}`, {
    next: { revalidate: 0 }
  })

  if (!res.ok) throw new Error(`SEMrush API error: ${res.status}`)

  const text = await res.text()
  return parseSemrushResponse(text)
}

// Tool 2: 相关关键词扩展
export async function getRelatedKeywords(
  seedKeyword: string,
  db: string = DEFAULT_DB,
  limit: number = 50
): Promise<SemrushKeywordData[]> {
  const params = new URLSearchParams({
    type: 'phrase_related',
    key: API_KEY,
    phrase: seedKeyword,
    database: db,
    export_columns: 'Ph,Nq,Kd,Cp,In',
    display_limit: String(limit),
    display_sort: 'nq_desc',
  })

  const res = await fetch(`${SEMRUSH_API_BASE}/?${params}`)
  if (!res.ok) throw new Error(`SEMrush API error: ${res.status}`)
  return parseSemrushResponse(await res.text())
}

// Tool 3: 竞品域名有机关键词
export async function getDomainOrganicKeywords(
  domain: string,
  db: string = DEFAULT_DB,
  limit: number = 50
): Promise<SemrushKeywordData[]> {
  const params = new URLSearchParams({
    type: 'domain_organic',
    key: API_KEY,
    domain,
    database: db,
    export_columns: 'Ph,Nq,Kd,Cp,In,Po',
    display_limit: String(limit),
    display_sort: 'nq_desc',
  })

  const res = await fetch(`${SEMRUSH_API_BASE}/?${params}`)
  if (!res.ok) throw new Error(`SEMrush API error: ${res.status}`)
  return parseSemrushResponse(await res.text())
}

// Tool 4: 关键词差距分析
export async function getKeywordGap(
  clientDomain: string,
  competitorDomains: string[],
  db: string = DEFAULT_DB,
  limit: number = 100
): Promise<SemrushKeywordData[]> {
  const domainParams = [clientDomain, ...competitorDomains]
    .map((d, i) => `domains[${i}][domain]=${d}&domains[${i}][type]=organic`)
    .join('&')

  const params = new URLSearchParams({
    type: 'phrase_kgap',
    key: API_KEY,
    database: db,
    export_columns: 'Ph,Nq,Kd,Cp,In',
    display_limit: String(limit),
    display_filter: `+|Ph|Co|${clientDomain}|missing`,
  })

  const res = await fetch(`${SEMRUSH_API_BASE}/?${params}&${domainParams}`)
  if (!res.ok) throw new Error(`SEMrush API error: ${res.status}`)
  return parseSemrushResponse(await res.text())
}

function parseSemrushResponse(text: string): SemrushKeywordData[] {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []

  return lines.slice(1).map(line => {
    const cols = line.split(';')
    return {
      keyword: cols[0]?.trim() || '',
      volume: parseInt(cols[1]) || 0,
      kd: parseInt(cols[2]) || 0,
      cpc: parseFloat(cols[3]) || 0,
      intent: normalizeIntent(cols[4]?.trim()),
      trend: [],
    }
  }).filter(k => k.keyword.length > 0)
}

// Tool 5: Domain overview snapshot for Master Brief pipeline
export interface DomainOverviewSnapshot {
  top_keywords: SemrushKeywordData[]
  competitor_domains: string[]
  estimated_traffic?: number
}

export async function getDomainOverviewSnapshot(
  domain: string,
  db: string = DEFAULT_DB,
  keywordLimit = 20
): Promise<DomainOverviewSnapshot> {
  try {
    const [topKeywords, competitors] = await Promise.allSettled([
      getDomainOrganicKeywords(domain, db, keywordLimit),
      getDomainCompetitors(domain, db),
    ])

    return {
      top_keywords: topKeywords.status === 'fulfilled' ? topKeywords.value : [],
      competitor_domains: competitors.status === 'fulfilled' ? competitors.value : [],
    }
  } catch {
    // Non-fatal: return empty snapshot rather than blocking brief generation
    return { top_keywords: [], competitor_domains: [] }
  }
}

async function getDomainCompetitors(
  domain: string,
  db: string = DEFAULT_DB,
  limit = 5
): Promise<string[]> {
  const params = new URLSearchParams({
    type: 'domain_organic_organic',
    key: API_KEY,
    domain,
    database: db,
    export_columns: 'Dn,Cr',
    display_limit: String(limit),
    display_sort: 'cr_desc',
  })

  const res = await fetch(`${SEMRUSH_API_BASE}/?${params}`)
  if (!res.ok) return []

  const text = await res.text()
  const lines = text.trim().split('\n').slice(1)
  return lines
    .map(l => l.split(';')[0]?.trim())
    .filter((d): d is string => Boolean(d) && d !== domain)
    .slice(0, limit)
}

// Tool 6: 问题型关键词（FAQ / 教育内容选题）
export async function getQuestionKeywords(
  seedKeyword: string,
  db: string = DEFAULT_DB,
  limit: number = 30
): Promise<SemrushKeywordData[]> {
  const params = new URLSearchParams({
    type: 'phrase_questions',
    key: API_KEY,
    phrase: seedKeyword,
    database: db,
    export_columns: 'Ph,Nq,Kd,Cp,In',
    display_limit: String(limit),
    display_sort: 'nq_desc',
  })

  const res = await fetch(`${SEMRUSH_API_BASE}/?${params}`)
  if (!res.ok) throw new Error(`SEMrush API error: ${res.status}`)
  return parseSemrushResponse(await res.text())
}

// Tool 7: 域名流量概览（SEO 健康度）
export interface DomainMetrics {
  organic_keywords: number
  organic_traffic: number
  authority_score: number
}

export async function getDomainMetrics(
  domain: string,
  db: string = DEFAULT_DB
): Promise<DomainMetrics> {
  const params = new URLSearchParams({
    type: 'domain_ranks',
    key: API_KEY,
    domain,
    database: db,
    export_columns: 'Or,Ot,As',
  })

  const res = await fetch(`${SEMRUSH_API_BASE}/?${params}`)
  if (!res.ok) return { organic_keywords: 0, organic_traffic: 0, authority_score: 0 }

  const text = await res.text()
  const lines = text.trim().split('\n')
  if (lines.length < 2) return { organic_keywords: 0, organic_traffic: 0, authority_score: 0 }

  const cols = lines[1].split(';')
  return {
    organic_keywords: parseInt(cols[0]) || 0,
    organic_traffic:  parseInt(cols[1]) || 0,
    authority_score:  parseInt(cols[2]) || 0,
  }
}

function normalizeIntent(raw?: string): string {
  const map: Record<string, string> = {
    '0': 'informational',
    '1': 'navigational',
    '2': 'commercial',
    '3': 'transactional',
    'informational': 'informational',
    'navigational': 'navigational',
    'commercial': 'commercial',
    'transactional': 'transactional',
  }
  return map[raw || ''] || 'informational'
}
