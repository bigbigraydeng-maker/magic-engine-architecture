/**
 * Apify social media scraper wrappers.
 *
 * Scrapes Instagram and Facebook public page data via Apify actors.
 * Callers are responsible for timeouts / retry logic.
 */

const APIFY_BASE = 'https://api.apify.com/v2'

export interface InstagramProfile {
  username: string
  followersCount: number
  postsLast30Days: number
  engagementRate: number   // decimal: 0.035 = 3.5%
  contentTypes: string[]   // e.g. ['image', 'video', 'reel']
}

export interface FacebookPage {
  pageName: string
  followersCount: number
  postsLast30Days: number
  engagementRate: number
}

export async function scrapeInstagramProfile(handle: string): Promise<InstagramProfile> {
  const token = process.env.APIFY_API_TOKEN
  if (!token) throw new Error('APIFY_API_TOKEN not configured')

  const res = await fetch(
    `${APIFY_BASE}/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${token}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        directUrls: [`https://www.instagram.com/${handle}/`],
        resultsType: 'details',
      }),
    },
  )

  if (!res.ok) throw new Error(`Apify Instagram error: ${res.status}`)

  const items = (await res.json()) as Record<string, unknown>[]
  const p = items[0] ?? {}

  return {
    username: (p['username'] as string | undefined) ?? handle,
    followersCount: (p['followersCount'] as number | undefined) ?? 0,
    postsLast30Days: (p['postsCount'] as number | undefined) ?? 0,
    engagementRate: ((p['engagementRate'] as number | undefined) ?? 0) / 100,
    contentTypes: (p['contentTypes'] as string[] | undefined) ?? [],
  }
}

export async function scrapeFacebookPage(pageUrl: string): Promise<FacebookPage> {
  const token = process.env.APIFY_API_TOKEN
  if (!token) throw new Error('APIFY_API_TOKEN not configured')

  const res = await fetch(
    `${APIFY_BASE}/acts/apify~facebook-pages-scraper/run-sync-get-dataset-items?token=${token}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startUrls: [{ url: pageUrl }] }),
    },
  )

  if (!res.ok) throw new Error(`Apify Facebook error: ${res.status}`)

  const items = (await res.json()) as Record<string, unknown>[]
  const p = items[0] ?? {}

  return {
    pageName: (p['title'] as string | undefined) ?? pageUrl,
    followersCount: (p['likes'] as number | undefined) ?? 0,
    postsLast30Days: (p['postsCount'] as number | undefined) ?? 0,
    engagementRate: ((p['engagementRate'] as number | undefined) ?? 0) / 100,
  }
}
