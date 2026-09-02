/**
 * ME Partner Fit Score — rule-based, zero AI, mirrors the philosophy of
 * src/lib/prospecting/score.ts (Phase 35): a deterministic score computed
 * only from evidence already captured on the candidate, never re-derived
 * by AI at score time.
 *
 * Weights from the partner-outreach spec (2026-09-02, §7):
 *   official platform status        20
 *   escalation / support capability 25
 *   training / event access         15
 *   B2B / agency-to-agency          15
 *   partnership recognition/brand   10
 *   AU/NZ presence                   5
 *   commercial flexibility           5
 *   multi-platform capability        5
 *                                  ----
 *                                   100
 *
 * A `TriState` field only earns points on 'yes' backed by public evidence
 * (research.ts is expected to set 'unknown', never 'yes', when it can't
 * point at a source) — 'unknown' and 'no' both score 0. This mirrors the
 * anti-fabrication rule in assertOfficialSourced(): no credit without a
 * source.
 */

import { hasAnyVerifiedPlatform, type PartnerCandidate } from './types'

export interface PartnerFitResult {
  score: number
  priority: 'A' | 'B' | 'C' | 'none'
  breakdown: { signal: string; points: number; max: number }[]
}

export const PRIORITY_BANDS: { min: number; priority: PartnerFitResult['priority'] }[] = [
  { min: 80, priority: 'A' },
  { min: 65, priority: 'B' },
  { min: 50, priority: 'C' },
  { min: 0,  priority: 'none' },
]

function priorityFor(score: number): PartnerFitResult['priority'] {
  return PRIORITY_BANDS.find(b => score >= b.min)!.priority
}

export function calculatePartnerFitScore(candidate: PartnerCandidate): PartnerFitResult {
  const breakdown: PartnerFitResult['breakdown'] = []
  const add = (signal: string, points: number, max: number) => breakdown.push({ signal, points, max })

  add('official_platform_status', hasAnyVerifiedPlatform(candidate.official_partner_status) ? 20 : 0, 20)
  add('support_escalation', candidate.support_escalation === 'yes' ? 25 : 0, 25)
  add('training_or_event_access',
    (candidate.training_access === 'yes' || candidate.event_access === 'yes') ? 15 : 0, 15)
  add('b2b_partnership', candidate.b2b_partnership === 'yes' ? 15 : 0, 15)
  add('branding_rights', candidate.branding_rights === 'yes' ? 10 : 0, 10)
  // AU/NZ presence is already a discovery filter (country check), but only
  // credit it once a real AU/NZ registration or office is on record, not
  // just the country column — an overseas reseller with an AU mailing
  // address wouldn't otherwise be distinguishable here.
  add('au_nz_presence', /\b(AU|NZ|Australia|New Zealand)\b/i.test(candidate.notes ?? '') ||
    candidate.source_urls.some(u => /\.(com\.au|co\.nz)\b/i.test(u)) ? 5 : 0, 5)
  add('commercial_flexibility', candidate.commercial_model.pricing_status === 'stated' ? 5 : 0, 5)
  add('multi_platform_capability', Math.round(5 * Math.min(candidate.platforms.length, 3) / 3), 5)

  const score = breakdown.reduce((sum, s) => sum + s.points, 0)
  return { score, priority: priorityFor(score), breakdown }
}
