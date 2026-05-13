import type { SupabaseClient } from '@supabase/supabase-js'
import { scrapeInstagramProfile } from '@/lib/apify/social-scraper'
import type { InstagramProfile } from '@/lib/apify/social-scraper'
import type { CollectorResult, NewFinding } from '../types'
import { MAX_COLLECTOR_TIMEOUT_MS, SOCIAL_CACHE_TTL_DAYS } from '../constants'

// ---------------------------------------------------------------------------
// Scoring constants
// ---------------------------------------------------------------------------

const FREQ_WEIGHT = 0.30
const ENGAGE_WEIGHT = 0.40
const DIVERSITY_WEIGHT = 0.30

const LOW_ENGAGE_THRESHOLD = 0.005   // 0.5%
const HIGH_POST_THRESHOLD = 12       // ≥12/month → no finding
const LOW_POST_HIGH = 4              // <4 → high severity
// <1 → critical severity (handled by 0-check)

// ---------------------------------------------------------------------------
// SocialCollector
// ---------------------------------------------------------------------------

export class SocialCollector {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly timeoutMs: number = MAX_COLLECTOR_TIMEOUT_MS,
  ) {}

  async collect(
    clientId: string,
    _domain: string,
    _keywords: string[],
  ): Promise<CollectorResult> {
    // P8.5.23: errors / no handle → cannot evaluate, not "zero"
    const fallback: CollectorResult = { score: null, findings: [] }

    try {
      // ── Cache check ────────────────────────────────────────────────────────
      if (await this.hasFreshCache(clientId)) {
        return fallback  // data was collected recently; skip re-analysis this run
      }

      // ── Fetch Instagram handle ─────────────────────────────────────────────
      const handle = await this.fetchInstagramHandle(clientId)
      if (!handle) {
        return {
          score: null,
          findings: [this.makeMissingPresenceFinding(clientId)],
        }
      }

      // ── Scrape with timeout ────────────────────────────────────────────────
      const timeout = new Promise<CollectorResult>(resolve =>
        setTimeout(() => resolve(fallback), this.timeoutMs),
      )

      return await Promise.race([this.scrapeAndScore(clientId, handle), timeout])
    } catch {
      return { score: null, findings: [] }
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async hasFreshCache(clientId: string): Promise<boolean> {
    const cutoff = new Date(
      Date.now() - SOCIAL_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString()

    const { data } = await this.supabase
      .from('diagnostic_findings')
      .select('id')
      .eq('client_id', clientId)
      .eq('dimension', 'social')
      .gte('created_at', cutoff)
      .limit(1)

    return (data as unknown[])?.length > 0
  }

  private async fetchInstagramHandle(clientId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('clients')
      .select('instagram_handle')
      .eq('id', clientId)
      .single()

    return (data as { instagram_handle: string | null } | null)?.instagram_handle ?? null
  }

  private async scrapeAndScore(clientId: string, handle: string): Promise<CollectorResult> {
    const profile = await scrapeInstagramProfile(handle)
    return this.buildResult(clientId, profile)
  }

  private buildResult(clientId: string, profile: InstagramProfile): CollectorResult {
    const findings: NewFinding[] = []

    // ── Posting frequency ──────────────────────────────────────────────────
    const posts = profile.postsLast30Days
    if (posts < HIGH_POST_THRESHOLD) {
      const severity = posts === 0 ? 'critical' : posts < LOW_POST_HIGH ? 'high' : 'medium'
      findings.push({
        client_id: clientId,
        dimension: 'social',
        finding_type: 'low_posting_frequency',
        severity,
        title: 'Low posting frequency',
        description: `Only ${posts} post${posts === 1 ? '' : 's'} published in the last 30 days.`,
        evidence: { posts_last_30_days: posts },
        recommendation: 'Aim for at least 3 posts per week to maintain audience engagement.',
        fix_type: 'fde_manual',
        priority_score: posts === 0 ? 90 : posts < LOW_POST_HIGH ? 70 : 50,
      })
    }

    // ── Engagement rate ────────────────────────────────────────────────────
    if (profile.engagementRate < LOW_ENGAGE_THRESHOLD) {
      findings.push({
        client_id: clientId,
        dimension: 'social',
        finding_type: 'low_engagement_rate',
        severity: 'high',
        title: 'Low engagement rate',
        description: `Engagement rate is ${(profile.engagementRate * 100).toFixed(2)}% — below the healthy threshold of 0.5%.`,
        evidence: { engagement_rate: profile.engagementRate },
        recommendation: 'Create more interactive content (polls, Q&A, calls-to-action) to boost engagement.',
        fix_type: 'fde_manual',
        priority_score: 65,
      })
    }

    const score = this.computeScore(profile)
    return { score, findings }
  }

  private computeScore(profile: InstagramProfile): number {
    const freqScore = this.postFrequencyScore(profile.postsLast30Days)
    const engageScore = this.engagementScore(profile.engagementRate)
    const diversityScore = this.diversityScore(profile.contentTypes)

    const raw = freqScore * FREQ_WEIGHT + engageScore * ENGAGE_WEIGHT + diversityScore * DIVERSITY_WEIGHT
    return Math.min(100, Math.max(0, Math.round(raw)))
  }

  private postFrequencyScore(posts: number): number {
    if (posts === 0) return 0
    if (posts < LOW_POST_HIGH) return 25
    if (posts < HIGH_POST_THRESHOLD) return 50
    if (posts < 24) return 75
    return 100
  }

  private engagementScore(rate: number): number {
    if (rate < LOW_ENGAGE_THRESHOLD) return 0
    if (rate < 0.01) return 25
    if (rate < 0.03) return 50
    if (rate < 0.05) return 75
    return 100
  }

  private diversityScore(types: string[]): number {
    const unique = new Set(types).size
    if (unique === 0) return 0
    if (unique === 1) return 33
    if (unique === 2) return 67
    return 100
  }

  private makeMissingPresenceFinding(clientId: string): NewFinding {
    return {
      client_id: clientId,
      dimension: 'social',
      finding_type: 'social_accounts_not_linked',
      severity: 'high',
      title: 'Social media accounts not linked',
      description:
        'No Instagram handle is linked for this client, so social performance (post frequency, engagement, content diversity) cannot be measured. This may mean the brand has no social presence at all, or the accounts simply haven\'t been connected to Magic Engine yet.',
      evidence: { instagram_handle: null, facebook_page: null },
      recommendation:
        'Open Client Settings → Social and add the Instagram handle + Facebook page URL. If the brand has no social accounts yet, prioritise launching at least Instagram (highest reach for visual-heavy categories like flooring/tiles).',
      fix_type: 'fde_manual',
      priority_score: 75,
    }
  }
}
