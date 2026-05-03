import type { PageType, KeywordIntent } from '@/types/magic-engine'

export function calculateOpportunityScore(params: {
  volume: number
  kd: number
  cpc: number
  intent: KeywordIntent
  isGap?: boolean
}): number {
  const { volume, kd, cpc, intent, isGap = false } = params

  const volumeScore = Math.min(100, (Math.log10(Math.max(volume, 1)) / Math.log10(10000)) * 100)
  const kdScore     = Math.max(0, 100 - (kd || 50))
  const cpcScore    = Math.min(100, ((cpc || 0) / 10) * 100)
  const intentScore = { transactional: 100, commercial: 80, navigational: 30, informational: 20 }[intent] ?? 10
  const gapBonus    = isGap ? 100 : 0

  return Math.round(
    (volumeScore * 0.30 + intentScore * 0.30 + cpcScore * 0.20 + kdScore * 0.15 + gapBonus * 0.05) * 100
  ) / 100
}

export function recommendPageType(keyword: string, intent: KeywordIntent, volume: number): PageType {
  const kw = keyword.toLowerCase()

  if (['tour', 'package', 'trip', 'travel', 'booking'].some(w => kw.includes(w)) &&
      ['commercial', 'transactional'].includes(intent)) return 'landing'

  if (['best', 'guide', 'how', 'tips', 'things to do', 'what to'].some(w => kw.includes(w))) return 'guide'

  if (volume > 1000 && ['beijing', 'shanghai', 'china', 'xian', 'chengdu'].some(w => kw.includes(w))) return 'hub'

  if (kw.match(/^(what|when|why|is |can |do i|how much)/)) return 'faq'

  return 'guide'
}
