import type { SupabaseClient } from '@supabase/supabase-js'
import type { CollectorResult, NewFinding } from '../types'
import { makeEvidence } from '../types'
import {
  runProbeWithTimeout,
  type LiveProbe,
  type LiveProbeResult,
} from '../ai-visibility-live-probe'

interface ClientRow {
  name: string
}

interface BriefRow {
  brand_name: string | null
}

// ---------------------------------------------------------------------------
// AiVisibilityCollector
// ---------------------------------------------------------------------------

export class AiVisibilityCollector {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly liveProbe: LiveProbe | null = null,
  ) {}

  async collect(
    clientId: string,
    _domain: string,
    _keywords: string[],
  ): Promise<CollectorResult> {
    try {
      // ai-tracker (system B) decommissioned — the weekly `ai_visibility_snapshots`
      // source is gone (spec 2026-08-19-ai-tracker-decommission-v1.md, 组 F).
      // AI visibility now relies solely on the diagnostic-time live probe until
      // M1 (geo_*) re-wire (P31.X.4). The probe currently has no per-client
      // query source (M1 living query set is P31.X.4, spec §9.2), so it returns
      // "skipped" → we report "not measured" (score: null), never a fabricated 0.
      const probe = await this.maybeRunLiveProbe(clientId)

      if (probe && !probe.skipped && probe.runs > 0) {
        return this.buildFromLiveProbe(clientId, probe)
      }

      return {
        score: null,
        findings: [this.makeAiVisibilityNotTrackedFinding(clientId)],
      }
    } catch {
      return { score: null, findings: [] }
    }
  }

  // ---------------------------------------------------------------------------
  // Live probe orchestration
  // ---------------------------------------------------------------------------

  private async maybeRunLiveProbe(clientId: string): Promise<LiveProbeResult | null> {
    if (!this.liveProbe) return null
    try {
      const brandName = await this.loadBrandName(clientId)
      if (!brandName) return null
      return await runProbeWithTimeout(this.liveProbe, { clientId, brandName })
    } catch {
      return null
    }
  }

  private async loadBrandName(clientId: string): Promise<string | null> {
    try {
      const { data: client } = await this.supabase
        .from('clients')
        .select('name')
        .eq('id', clientId)
        .single()
      const clientRow = client as ClientRow | null

      const { data: brief } = await this.supabase
        .from('master_briefs')
        .select('brand_name')
        .eq('client_id', clientId)
        .eq('status', 'active')
        .maybeSingle()
      const briefRow = brief as BriefRow | null

      const name = briefRow?.brand_name?.trim() || clientRow?.name?.trim()
      return name || null
    } catch {
      return null
    }
  }

  // ---------------------------------------------------------------------------
  // Finding builders
  // ---------------------------------------------------------------------------

  private makeAiVisibilityNotTrackedFinding(clientId: string): NewFinding {
    return {
      client_id: clientId,
      dimension: 'ai_visibility',
      finding_type: 'ai_visibility_not_tracked',
      severity: 'critical',
      title: 'AI Visibility not yet measured',
      description:
        'AI engine visibility has not been measured for this brand yet. AI visibility measurement is being migrated to the unified GEO measurement pipeline; until this client is onboarded there, we cannot score or improve it. This is "not measured", not a zero score.',
      evidence: makeEvidence({ parsed: { measured: false } }),
      recommendation:
        'Onboard this client into the unified GEO measurement pipeline so ChatGPT / Perplexity / Gemini brand visibility can be tracked and scored.',
      fix_type: 'me_auto',
      priority_score: 88,
    }
  }

  // ---------------------------------------------------------------------------
  // Result composition
  // ---------------------------------------------------------------------------

  private buildFromLiveProbe(clientId: string, probe: LiveProbeResult): CollectorResult {
    const mentionRate = probe.mentions / Math.max(1, probe.runs)
    const rankScore =
      probe.avg_rank !== null ? Math.max(0, (5 - probe.avg_rank) / 4) : 0
    const score = Math.min(100, Math.max(0, Math.round(mentionRate * 70 + rankScore * 30)))

    const findings: NewFinding[] = []
    if (probe.mentions === 0) {
      findings.push({
        client_id: clientId,
        dimension: 'ai_visibility',
        finding_type: 'brand_not_mentioned',
        severity: 'critical',
        title: 'Brand Not Mentioned by AI (live probe)',
        description: `A diagnostic-time probe ran ${probe.runs} priority question(s) on ChatGPT and your brand was not mentioned. AI-powered search is growing rapidly — missing from AI results means missing a key discovery channel.`,
        evidence: makeEvidence({ parsed: { live_probe: probeEvidence(probe) } }),
        recommendation:
          'Add GEO directives to your content, create entity-rich FAQ pages, and build citations on authoritative NZ/AU sites to improve AI visibility.',
        fix_type: 'fde_manual',
        priority_score: 95,
      })
    } else if (probe.avg_rank !== null && probe.avg_rank > 3) {
      findings.push({
        client_id: clientId,
        dimension: 'ai_visibility',
        finding_type: 'low_ai_rank',
        severity: 'high',
        title: 'Low AI Ranking Position (live probe)',
        description: `Your brand appeared at an average position of ${probe.avg_rank.toFixed(1)} in a ${probe.runs}-question diagnostic probe, below the recommended threshold of 3.`,
        evidence: makeEvidence({ parsed: { live_probe: probeEvidence(probe) } }),
        recommendation:
          'Strengthen your brand\'s online authority by creating comprehensive FAQ content, earning mentions on authoritative sites, and implementing GEO directives in your content.',
        fix_type: 'fde_manual',
        priority_score: 70,
      })
    }

    return { score, findings }
  }
}

// ---------------------------------------------------------------------------
// Evidence serialiser — keeps live-probe shape consistent across findings.
// ---------------------------------------------------------------------------

function probeEvidence(probe: LiveProbeResult | null): Record<string, unknown> | null {
  if (!probe || probe.skipped) return null
  return {
    runs: probe.runs,
    mentions: probe.mentions,
    avg_rank: probe.avg_rank,
    questions: probe.questions,
    latency_ms: probe.latency_ms,
  }
}
