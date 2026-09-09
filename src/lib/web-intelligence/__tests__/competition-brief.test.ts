import { describe, expect, it } from 'vitest'
import { buildCompetitionBrief } from '../competition-brief'

const input = {
  clientName: 'CTS Tours NZ', clientDomain: 'ctstours.co.nz', competitorCount: 1, configuredPageCount: 2,
  snapshots: { failed: false, data: [{ domain: 'wendywutours.co.nz', url: 'https://wendywutours.co.nz/china/tours/', page_role: 'product_listing', projection_version: 'me-travel-v2', captured_at: '2026-09-09T00:00:00Z', projection_content: 'Tour: Wonders of China | Duration: 17 days | Price: NZ$9,030 | Promotion: Early Bird | Reviews: 428 | Route: Shanghai - Xian - Chengdu' }] },
  baselines: { failed: false, data: [{ domain: 'ctstours.co.nz', seo_score: 26, last_collected_at: '2026-09-01', is_client: true }, { domain: 'wendywutours.co.nz', seo_score: 22, last_collected_at: '2026-09-01', is_client: false }] },
  reputation: { failed: false, data: [] }, ai: { failed: false, data: null },
  now: new Date('2026-09-10T00:00:00Z'),
}

describe('buildCompetitionBrief', () => {
  it('turns current tour evidence into an operating brief without inventing a total score', () => {
    const brief = buildCompetitionBrief(input)
    expect(brief.subject).toBe('Tour')
    expect(brief.headline).toContain('竞品Tour盘面已可查看')
    expect(brief.actions).toHaveLength(3)
    expect(brief.dimensions.find(item => item.key === 'product')?.status).toBe('stale')
    expect(brief.dimensions.find(item => item.key === 'product')?.items).toEqual(['wendywutours.co.nz · Wonders of China · 17 days · NZ$9,030 · Early Bird'])
    expect(brief.dimensions.find(item => item.key === 'search')?.detail).toContain('不等于 Google 排名')
    expect(brief.dimensions.find(item => item.key === 'reputation')?.status).toBe('unconfigured')
  })

  it('recognises legacy Tour snapshots when the profile version is missing', () => {
    const brief = buildCompetitionBrief({
      ...input,
      snapshots: { ...input.snapshots, data: input.snapshots.data.map(row => ({ ...row, projection_version: null })) },
    })
    expect(brief.subject).toBe('Tour')
    expect(brief.headline).toContain('竞品Tour盘面')
  })

  it('does not call single-sided dimensions directly comparable', () => {
    const complete = buildCompetitionBrief({
      ...input, configuredPageCount: 1,
      reputation: { failed: false, data: [{ entity_type: 'client' as const, entity_name: 'CTS Tours NZ', source: 'gbp', rating: 4.4, review_count: 12, snapshot_date: '2026-09-09', measured_at: '2026-09-09T00:00:00Z' }] },
      ai: { failed: false, data: { week_of: '2026-09-07', avg_rank: 2.05, mentions_count: 59, total_runs: 204, models_covered: ['gpt'] } },
    })
    expect(complete.dimensions.map(item => [item.key, item.status])).toEqual([
      ['product', 'limited'], ['search', 'ready'], ['reputation', 'limited'], ['ai_visibility', 'limited'],
    ])
    expect(complete.summary).toContain('1/4 个维度可直接竞争对比，3 个只有单方或有限数据')
  })

  it('requires real metrics and the same review platform before claiming comparability', () => {
    const brief = buildCompetitionBrief({
      ...input, configuredPageCount: 1,
      baselines: { failed: false, data: [{ domain: 'ctstours.co.nz', seo_score: null, last_collected_at: '2026-09-09', is_client: true }, { domain: 'wendywutours.co.nz', seo_score: null, last_collected_at: '2026-09-09', is_client: false }] },
      reputation: { failed: false, data: [
        { entity_type: 'client' as const, entity_name: 'CTS', source: 'gbp', rating: 4.4, review_count: 12, snapshot_date: '2026-09-09', measured_at: '2026-09-09T00:00:00Z' },
        { entity_type: 'competitor' as const, entity_name: 'Wendy Wu', source: 'tripadvisor', rating: 4.5, review_count: 100, snapshot_date: '2026-09-09', measured_at: '2026-09-09T00:00:00Z' },
      ] },
    })
    expect(brief.dimensions.find(item => item.key === 'search')?.status).toBe('limited')
    expect(brief.dimensions.find(item => item.key === 'reputation')?.status).toBe('limited')
    expect(brief.summary).toContain('0/4 个维度可直接竞争对比')
  })

  it('requires a shared review metric on the same platform', () => {
    const brief = buildCompetitionBrief({
      ...input, configuredPageCount: 1,
      reputation: { failed: false, data: [
        { entity_type: 'client' as const, entity_name: 'CTS', source: 'gbp', rating: 4.4, review_count: null, snapshot_date: '2026-09-09', measured_at: '2026-09-09T00:00:00Z' },
        { entity_type: 'competitor' as const, entity_name: 'Wendy Wu', source: 'gbp', rating: null, review_count: 100, snapshot_date: '2026-09-09', measured_at: '2026-09-09T00:00:00Z' },
      ] },
    })
    expect(brief.dimensions.find(item => item.key === 'reputation')?.status).toBe('limited')
  })

  it('does not present an empty AI sample as a measured zero', () => {
    const brief = buildCompetitionBrief({ ...input, ai: { failed: false, data: { week_of: '2026-09-07', avg_rank: null, mentions_count: 0, total_runs: 0, models_covered: [] } } })
    const ai = brief.dimensions.find(item => item.key === 'ai_visibility')
    expect(ai?.status).toBe('no_observation')
    expect(ai?.headline).toBe('尚无 CTS Tours NZ 的有效 AI 推荐快照')
    expect(ai?.headline).not.toContain('0%')
  })

  it('uses the selected client identity in missing-data actions', () => {
    const brief = buildCompetitionBrief({ ...input, clientName: 'Example Dental', clientDomain: 'exampledental.co.nz', snapshots: { failed: false, data: [] } })
    expect(brief.subject).toBe('产品')
    expect(brief.actions.join(' ')).toContain('Example Dental')
    expect(brief.actions.join(' ')).not.toContain('CTS')
    expect(brief.headline).not.toContain('9 月')
  })

  it('shows read failures and stale observations instead of converting them to zero', () => {
    const brief = buildCompetitionBrief({
      ...input,
      snapshots: { failed: true, data: [] },
      baselines: { failed: false, data: [{ domain: 'ctstours.co.nz', seo_score: 26, last_collected_at: '2026-01-01', is_client: true }] },
    })
    expect(brief.dimensions.find(item => item.key === 'product')?.status).toBe('failed')
    expect(brief.dimensions.find(item => item.key === 'search')?.status).toBe('stale')
    expect(brief.warnings).toContain('竞品业务页面读取失败。')
  })
})
