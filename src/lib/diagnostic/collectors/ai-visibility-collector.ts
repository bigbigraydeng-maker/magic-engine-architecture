import type { SupabaseClient } from '@supabase/supabase-js'
import type { CollectorResult, NewFinding } from '../types'

// ---------------------------------------------------------------------------
// Snapshot shape (subset of ai_visibility_snapshots columns)
// ---------------------------------------------------------------------------

interface VisibilitySnapshot {
  avg_rank: number | null
  mentions_count: number
  total_runs: number
  week_of: string
}

// ---------------------------------------------------------------------------
// AiVisibilityCollector
// ---------------------------------------------------------------------------

export class AiVisibilityCollector {
  constructor(private readonly supabase: SupabaseClient) {}

  async collect(
    clientId: string,
    _domain: string,
    _keywords: string[],
  ): Promise<CollectorResult> {
    try {
      const { data, error } = await this.supabase
        .from('ai_visibility_snapshots')
        .select('avg_rank, mentions_count, total_runs, week_of')
        .eq('client_id', clientId)
        .order('week_of', { ascending: false })
        .limit(1)

      // P8.5.22: DB error → cannot evaluate, not "zero score"
      if (error) return { score: null, findings: [] }

      const snapshot = (data as VisibilitySnapshot[] | null)?.[0] ?? null

      // No snapshot at all → AI Tracker has never run for this client
      if (!snapshot) {
        return {
          score: null,
          findings: [this.makeAiVisibilityNotTrackedFinding(clientId)],
        }
      }

      // Snapshot exists with 0 mentions → real signal: client is invisible to AI
      if (snapshot.mentions_count === 0) {
        return {
          score: 0,
          findings: [this.makeNotMentionedFinding(clientId)],
        }
      }

      return this.buildResult(clientId, snapshot)
    } catch {
      return { score: null, findings: [] }
    }
  }

  private makeAiVisibilityNotTrackedFinding(clientId: string): import('../types').NewFinding {
    return {
      client_id: clientId,
      dimension: 'ai_visibility',
      finding_type: 'ai_visibility_not_tracked',
      severity: 'critical',
      title: 'AI Visibility Tracker not yet enabled',
      description:
        'No AI Visibility snapshot exists for this client — AI Tracker has never queried ChatGPT / Perplexity / Gemini for this brand. AI engine visibility is a core differentiator in the current GEO landscape; without tracking we cannot measure or improve it.',
      evidence: { snapshots: 0 },
      recommendation:
        'Enable weekly AI Tracker: configure 10–20 priority brand/category questions in Client Settings → AI Visibility, then wait for the next Monday cron run (or trigger an ad-hoc run via Run-once button).',
      fix_type: 'me_auto',
      priority_score: 88,
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildResult(clientId: string, snapshot: VisibilitySnapshot): CollectorResult {
    const findings: NewFinding[] = []
    const mentionRate = snapshot.mentions_count / Math.max(1, snapshot.total_runs)

    const rankScore =
      snapshot.avg_rank !== null
        ? Math.max(0, (5 - snapshot.avg_rank) / 4)
        : 0

    const score = Math.min(100, Math.max(0, Math.round(mentionRate * 70 + rankScore * 30)))

    if (snapshot.avg_rank !== null && snapshot.avg_rank > 3) {
      findings.push({
        client_id: clientId,
        dimension: 'ai_visibility',
        finding_type: 'low_ai_rank',
        severity: 'high',
        title: 'Low AI Ranking Position',
        description: `Your brand appears at an average position of ${snapshot.avg_rank.toFixed(1)} in AI responses, below the recommended threshold of 3.`,
        evidence: {
          avg_rank: snapshot.avg_rank,
          mentions_count: snapshot.mentions_count,
          total_runs: snapshot.total_runs,
          week_of: snapshot.week_of,
        },
        recommendation:
          'Strengthen your brand\'s online authority by creating comprehensive FAQ content, earning mentions on authoritative sites, and implementing GEO directives in your content.',
        fix_type: 'fde_manual',
        priority_score: 70,
      })
    }

    return { score, findings }
  }

  private makeNotMentionedFinding(clientId: string): NewFinding {
    return {
      client_id: clientId,
      dimension: 'ai_visibility',
      finding_type: 'brand_not_mentioned',
      severity: 'critical',
      title: 'Brand Not Mentioned by AI',
      description:
        'Your brand was not mentioned in any AI engine responses this week. AI-powered search is growing rapidly — missing from AI results means missing a key discovery channel.',
      evidence: null,
      recommendation:
        'Add GEO directives to your content, create entity-rich FAQ pages, and build citations on authoritative NZ/AU sites to improve AI visibility.',
      fix_type: 'fde_manual',
      priority_score: 95,
    }
  }
}
