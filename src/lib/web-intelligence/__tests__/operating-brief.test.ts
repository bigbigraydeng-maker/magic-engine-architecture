import { describe, expect, it } from 'vitest'
import { buildOperatingBrief, resolveCurrentOperatingGoal } from '../operating-brief'
import type { TravelScope } from '../profiles/travel'

const scope: TravelScope = { status: 'configured', market_ids: ['china'], labels: ['中国'], basis: ['China'], source: '主力产品', rule_version: 'travel-market-v1' }
const record = { name: 'Wonders of China', durationDays: 17, price: 'from $9,030PP', promotion: 'EARLY BIRD SALE', reviews: '425 Reviews', includes: 'Fully Inclusive', route: 'China Great Wall Xian Yangtze River' }
const evidence = [{ id: '00000000-0000-0000-0000-000000000001', client_id: 'client', source: 'competitor website', scope: 'competitor' as const, statement: 'Wendy Wu has a China Tour', observed_at: '2026-09-10T00:00:00Z', fact_type: 'fact' as const, confidence: 'high' as const }]

describe('buildOperatingBrief', () => {
  it('refuses price advice when the client product source is missing', () => {
    const brief = buildOperatingBrief({ client: { id: 'client', name: 'Example Travel' }, goal: null, product_scope: scope, client_products: [], competitor_products: [{ domain: 'competitor.example', source_url: 'https://competitor.example/china', observed_at: evidence[0].observed_at, records: [record] }], evidence, now: new Date('2026-09-11T00:00:00Z') })
    expect(brief.matches[0].status).toBe('insufficient_evidence')
    expect(brief.decision.recommendation).toContain('暂不调价')
    expect(brief.decision.authorization).toBe('review_required')
  })

  it('fails closed when the client product lacks comparison fields', () => {
    const brief = buildOperatingBrief({ client: { id: 'client', name: 'Example Travel' }, goal: { title: 'Grow leads', status: 'active', metric: 'leads/mo', target: 30, period_start: '2026-09-01', period_end: '2026-10-01' }, product_scope: scope, client_products: [{ name: 'China Highlights' }], competitor_products: [{ domain: 'competitor.example', source_url: 'https://competitor.example/china', observed_at: evidence[0].observed_at, records: [record] }], evidence })
    expect(brief.matches[0].status).toBe('insufficient_evidence')
    expect(brief.matches[0].reason).toContain('客户产品缺少')
  })

  it('does not compare tours with a different route, duration, or price basis', () => {
    const brief = buildOperatingBrief({ client: { id: 'client', name: 'Example Travel' }, goal: null, product_scope: scope, client_products: [{ name: 'China Highlights', destination: 'China', route: 'Beijing Shanghai', duration_days: 12, price: 'NZD 4999 pp', departure_window: 'November 2026', includes: 'Flights hotels', positioning: 'small group', audience: 'NZ travellers' }], competitor_products: [{ domain: 'competitor.example', source_url: 'https://competitor.example/china', observed_at: evidence[0].observed_at, records: [{ ...record, route: 'Beijing Xian', durationDays: 14, price: 'AUD 9030 pp', departureWindow: 'November 2026', includes: 'Flights hotels', positioning: 'large group', audience: 'NZ travellers' }] }], evidence, now: new Date('2026-09-11T00:00:00Z') })
    expect(brief.matches[0].status).toBe('insufficient_evidence')
    expect(brief.matches[0].reason).toContain('逐项对位')
  })

  it('keeps an explicit out-of-scope tour out of the decision', () => {
    const brief = buildOperatingBrief({ client: { id: 'client', name: 'Example Travel' }, goal: null, product_scope: scope, client_products: [], competitor_products: [{ domain: 'competitor.example', source_url: 'https://competitor.example/japan', observed_at: null, records: [{ ...record, name: 'Japan Discovery', route: 'Japan Tokyo Kyoto' }] }], evidence, now: new Date('2026-09-11T00:00:00Z') })
    expect(brief.matches[0].status).toBe('out_of_scope')
    expect(brief.matches[0].reason).toContain('范围之外')
  })

  it('does not treat an active but expired goal as current', () => {
    expect(resolveCurrentOperatingGoal([{ title: 'Expired', status: 'active', primary_metric_label: 'leads', target_value: 30, period_start: '2026-08-01', period_end: '2026-09-02' }], new Date('2026-09-11T00:00:00Z'))).toBeNull()
  })

  it('returns an active goal only when its period includes today', () => {
    expect(resolveCurrentOperatingGoal([{ title: 'Current', status: 'active', primary_metric_label: 'leads', target_value: 30, period_start: '2026-09-01', period_end: '2026-10-01' }], new Date('2026-09-11T00:00:00Z'))?.title).toBe('Current')
  })
})
