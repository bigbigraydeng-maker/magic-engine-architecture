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
  const token = process.env.APIFY_API_KEY
  if (!token) throw new Error('APIFY_API_KEY not configured')

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
  const token = process.env.APIFY_API_KEY
  if (!token) throw new Error('APIFY_API_KEY not configured')

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

export interface TiktokProfile {
  handle: string
  followersCount: number
  postsLast30Days: number
  engagementRate: number  // decimal: 0.035 = 3.5%
  contentTypes: string[]  // always ['video'] for TikTok
}

export async function scrapeTiktokProfile(handle: string): Promise<TiktokProfile> {
  const token = process.env.APIFY_API_KEY
  if (!token) throw new Error('APIFY_API_KEY not configured')

  const cleanHandle = handle.replace(/^@/, '')
  const profileUrl = `https://www.tiktok.com/@${cleanHandle}`

  const res = await fetch(
    `${APIFY_BASE}/acts/clockworks~tiktok-profile-scraper/run-sync-get-dataset-items?token=${token}&timeout=60`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        profiles: [profileUrl],
        resultsPerPage: 30,
      }),
    },
  )

  if (!res.ok) throw new Error(`Apify TikTok error: ${res.status}`)

  const items = (await res.json()) as Record<string, unknown>[]
  if (items.length === 0) {
    return { handle: cleanHandle, followersCount: 0, postsLast30Days: 0, engagementRate: 0, contentTypes: ['video'] }
  }

  const first = items[0]
  const authorMeta = (first['authorMeta'] as Record<string, unknown> | undefined) ?? {}
  const followersCount = (authorMeta['fans'] as number | undefined) ?? 0

  // Count posts published in the last 30 days.
  // TikTok createTime is unix seconds (10 digits); guard against actor versions
  // that return milliseconds (13 digits) by normalising to seconds.
  const cutoffSec = (Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000
  const recentPosts = items.filter(item => {
    let ts = (item['createTime'] as number | undefined) ?? 0
    if (ts > 1e12) ts = ts / 1000   // milliseconds → seconds
    return ts > cutoffSec
  })

  // Engagement rate = avg (likes + comments) per post / followers
  let totalEngagement = 0
  for (const post of recentPosts) {
    totalEngagement +=
      ((post['diggCount'] as number | undefined) ?? 0) +
      ((post['commentCount'] as number | undefined) ?? 0)
  }
  const engagementRate =
    followersCount > 0 && recentPosts.length > 0
      ? Math.min(1, totalEngagement / (recentPosts.length * followersCount))
      : 0

  return {
    handle: cleanHandle,
    followersCount,
    postsLast30Days: recentPosts.length,
    engagementRate,
    contentTypes: ['video'],
  }
}
