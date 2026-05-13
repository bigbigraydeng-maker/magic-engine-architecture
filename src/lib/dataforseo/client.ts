import { validateEnvVar } from '@/lib/validation-utils'

const DATAFORSEO_API_BASE = 'https://api.dataforseo.com/v3'

function getCredentials(): { login: string; password: string } {
  return {
    login: validateEnvVar('DATAFORSEO_LOGIN'),
    password: validateEnvVar('DATAFORSEO_PASSWORD'),
  }
}

export interface CompetitorDomain {
  domain: string
  overlap_score: number  // 0–1, shared keyword ratio vs client
  organic_traffic: number
  authority_score: number
}

export async function getCompetitorDomains(
  domain: string,
  limit: number = 5,
): Promise<CompetitorDomain[]> {
  const { login, password } = getCredentials()
  const credentials = Buffer.from(`${login}:${password}`).toString('base64')

  const res = await fetch(`${DATAFORSEO_API_BASE}/serp/google/organic/live/advanced`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      {
        keyword: `site:${domain}`,
        location_code: 2554,  // Australia
        language_code: 'en',
        depth: 10,
      },
    ]),
  })

  if (!res.ok) throw new Error(`DataForSEO API error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      result?: Array<{
        items?: Array<{
          domain?: string
          etv?: number
          intersections?: number
        }>
      }>
    }>
  }

  const items = json.tasks?.[0]?.result?.[0]?.items ?? []

  return items
    .filter(item => item.domain && item.domain !== domain)
    .slice(0, limit)
    .map(item => ({
      domain: item.domain ?? '',
      overlap_score: Math.min(1, (item.intersections ?? 0) / 100),
      organic_traffic: item.etv ?? 0,
      authority_score: 0,
    }))
}
