import type { GoalRow } from '@/types/strategy'
import type { SeoActionType, SeoExecutionPath, SeoKeywordCandidate, SeoPageType } from './types'

export interface RawSeoCandidate {
  keyword: string
  source: 'gap' | 'ranking' | 'position_change'
  intent: string
  search_volume: number | null
  keyword_difficulty: number | null
  position: number | null
  previous_position: number | null
  position_delta: number | null
  has_business_match: boolean
  has_location_match: boolean
}

const INTENT_SCORE: Record<string, number> = {
  transactional: 28,
  commercial: 24,
  informational: 14,
  navigational: 2,
}

export function buildScoredCandidate(
  candidate: RawSeoCandidate,
  goal: GoalRow | null,
): SeoKeywordCandidate {
  const page_type = derivePageType(candidate.keyword, candidate.intent, candidate.has_location_match)
  const action_type = deriveActionType(candidate.source, candidate.intent, candidate.position)
  const execution_path = deriveExecutionPath(action_type)

  return {
    ...candidate,
    action_type,
    page_type,
    execution_path,
    score: scoreCandidate(candidate, goal, action_type),
  }
}

export function scoreCandidate(
  candidate: RawSeoCandidate,
  goal: GoalRow | null,
  actionType: SeoActionType,
): number {
  const intentScore = INTENT_SCORE[candidate.intent] ?? INTENT_SCORE.informational
  const volumeScore = volumeBand(candidate.search_volume)
  const kdScore = difficultyBand(candidate.keyword_difficulty)
  const sourceScore = sourceBand(candidate.source, candidate.position)
  const businessScore = candidate.has_business_match ? 22 : -30
  const locationScore = candidate.has_location_match ? 12 : 0
  const goalScore = goalBand(goal, candidate.intent, actionType, candidate.has_location_match)

  return Math.max(
    0,
    Math.round(intentScore + volumeScore + kdScore + sourceScore + businessScore + locationScore + goalScore),
  )
}

export function derivePageType(
  keyword: string,
  intent: string,
  hasLocationMatch: boolean,
): SeoPageType {
  const normalized = keyword.toLowerCase()
  if (/\b(vs|versus|compare|comparison)\b/.test(normalized)) return 'comparison_article'
  if (/\b(how|best|what|why|guide|cost|ideas)\b/.test(normalized) || intent === 'informational') {
    return 'guide_article'
  }
  if (hasLocationMatch) return 'location_page'
  if (/\b(category|range|types|products)\b/.test(normalized)) return 'category_page'
  return 'service_page'
}

export function deriveActionType(
  source: RawSeoCandidate['source'],
  intent: string,
  position: number | null,
): SeoActionType {
  if (source === 'position_change' && position !== null) return 'refresh_existing_page'
  if (source === 'ranking' && position !== null && position <= 20) return 'refresh_existing_page'
  if (intent === 'informational') return 'publish_support_content'
  return 'create_money_page'
}

export function deriveExecutionPath(actionType: SeoActionType): SeoExecutionPath {
  if (actionType === 'publish_support_content') return 'blog_now'
  if (actionType === 'refresh_existing_page') return 'page_upgrade'
  return 'manual_page_brief'
}

function volumeBand(volume: number | null): number {
  if (volume === null || volume <= 0) return 0
  if (volume >= 1000) return 16
  if (volume >= 300) return 12
  if (volume >= 100) return 8
  if (volume >= 30) return 5
  return 2
}

function difficultyBand(kd: number | null): number {
  if (kd === null) return 2
  if (kd <= 20) return 10
  if (kd <= 35) return 7
  if (kd <= 50) return 4
  if (kd <= 70) return 1
  return -4
}

function sourceBand(source: RawSeoCandidate['source'], position: number | null): number {
  if (source === 'gap') return 16
  if (source === 'position_change') return 12
  if (position !== null && position > 3 && position <= 20) return 14
  if (position !== null && position <= 3) return 4
  return 8
}

function goalBand(
  goal: GoalRow | null,
  intent: string,
  actionType: SeoActionType,
  hasLocationMatch: boolean,
): number {
  if (!goal) return 0

  if (goal.intent === 'acquisition') {
    if (actionType === 'create_money_page') return hasLocationMatch ? 16 : 10
    if (intent === 'informational') return 4
  }

  if (goal.intent === 'sales') {
    if (actionType === 'create_money_page') return 14
    if (actionType === 'refresh_existing_page') return 10
  }

  if (goal.sub_type === 'geographic_expansion' && hasLocationMatch) return 18
  if (goal.sub_type === 'conversion_lift' && actionType === 'refresh_existing_page') return 14
  if (goal.sub_type === 'ongoing_revenue' && actionType === 'create_money_page') return 12

  return 0
}
