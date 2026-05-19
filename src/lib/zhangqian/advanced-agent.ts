/**
 * 张骞 Advanced Discovery — targeted FB / Meta enrichment pass.
 *
 * Reference: ROADMAP.md P8.10.S0.22
 *
 * Runs ONLY after a connector (meta-ads or gbp) is authorised. Does not
 * re-run the full Claude agent — instead it targets the two scrapers that
 * were intentionally excluded from the first-time discovery pass:
 *
 *   1. scrapeCompetitorMetaAds  → DiscoveredMetaAds (Meta Ad Library)
 *   2. scrapeFacebookPage       → AdvancedFacebookProfile[] (real FB metrics)
 *
 * Returns an AdvancedDiscoveryPayload that the caller merges into
 * client_discovery.payload.advanced without overwriting the basic report.
 */

import { scrapeCompetitorMetaAds } from '@/lib/apify/ad-library'
import { scrapeFacebookPage } from '@/lib/apify/social-scraper'
import type {
  AdvancedDiscoveryPayload,
  AdvancedFacebookProfile,
  DiscoveredMetaAds,
  DiscoveryReport,
} from './types'

// ─── Constants ────────────────────────────────────────────────────────────────

// Each Apify scrape is external — cap them individually so a hung connection
// can't block the job past the 6-min stale threshold.
const META_ADS_TIMEOUT_MS = 90_000
const FACEBOOK_SCRAPE_TIMEOUT_MS = 90_000

// Cap FB page scrapes per run: each is a paid Apify call and the first-time
// pass typically finds at most one FB page for an AU/NZ SMB.
const MAX_FB_PROFILES = 2

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run the advanced enrichment pass for a client's domain.
 *
 * @param domain        The client's primary domain (used for Meta Ad Library lookup).
 * @param basicReport   The existing basic DiscoveryReport (to find FB profile URLs).
 * @param triggeredBy   Connector anchor that triggered this run ('meta-ads' | 'gbp').
 * @param onProgress    Optional callback for progress UI updates.
 */
export async function runZhangqianAdvanced(
  domain: string,
  basicReport: DiscoveryReport,
  triggeredBy: string,
  onProgress?: (note: string) => void | Promise<void>,
): Promise<AdvancedDiscoveryPayload> {
  const startedAt = Date.now()
  const notify = onProgress ?? (() => undefined)

  // ── Step 1: Meta Ad Library ──────────────────────────────────────────────
  await notify('高级发现：正在扫描 Meta 广告库…')

  const meta_ads = await scrapeMetaAdsWithTimeout(domain, notify)

  // ── Step 2: Facebook Page metrics ────────────────────────────────────────
  const fbUrls = basicReport.social_profiles
    .filter(p => p.platform === 'facebook' && p.url)
    .slice(0, MAX_FB_PROFILES)
    .map(p => p.url)

  const facebook_profiles = await scrapeFacebookProfilesWithTimeout(fbUrls, notify)

  return {
    meta_ads,
    facebook_profiles,
    meta: {
      duration_ms: Date.now() - startedAt,
      cost_usd: 0,   // Apify costs tracked externally; no Claude usage here
      ran_at: new Date().toISOString(),
      triggered_by: triggeredBy,
    },
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function scrapeMetaAdsWithTimeout(
  domain: string,
  notify: (note: string) => void | Promise<void>,
): Promise<DiscoveredMetaAds | null> {
  try {
    const result = await withTimeout(
      scrapeCompetitorMetaAds(domain),
      META_ADS_TIMEOUT_MS,
      'Meta Ad Library timeout',
    )
    const meta_ads: DiscoveredMetaAds = {
      active_ads_count: result.activeAdsCount,
      ad_types: result.adTypes,
      estimated_spend: result.estimatedSpend,
      top_ad_copy: result.topAdCopy,
    }
    await notify(`高级发现：Meta 广告库扫描完成（${result.activeAdsCount} 条活跃广告）`)
    return meta_ads
  } catch (err) {
    console.warn('[advanced-agent] Meta ads scrape failed:', err instanceof Error ? err.message : err)
    await notify('高级发现：Meta 广告库扫描失败，继续…')
    return null
  }
}

async function scrapeFacebookProfilesWithTimeout(
  urls: string[],
  notify: (note: string) => void | Promise<void>,
): Promise<AdvancedFacebookProfile[]> {
  const results: AdvancedFacebookProfile[] = []

  for (const url of urls) {
    await notify(`高级发现：正在抓取 Facebook 主页 ${url}…`)
    try {
      const raw = await withTimeout(
        scrapeFacebookPage(url),
        FACEBOOK_SCRAPE_TIMEOUT_MS,
        `Facebook page timeout: ${url}`,
      )
      results.push({
        url,
        page_name: raw.pageName,
        followers_count: raw.followersCount,
        posts_last_30d: raw.postsLast30Days,
        engagement_rate: raw.engagementRate,
      })
      await notify(`高级发现：Facebook 主页「${raw.pageName}」数据已获取（${raw.followersCount.toLocaleString()} 粉丝）`)
    } catch (err) {
      console.warn(`[advanced-agent] FB scrape failed for ${url}:`, err instanceof Error ? err.message : err)
      await notify(`高级发现：Facebook 主页抓取失败（${url}），继续…`)
    }
  }

  return results
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(label)), ms),
    ),
  ])
}
