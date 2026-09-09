import { describe, expect, it } from 'vitest'
import { buildCompetitionBrief } from '../competition-brief'

const input = {
  clientName: 'CTS Tours NZ', clientDomain: 'ctstours.co.nz', competitorCount: 1, configuredPageCount: 2,
  snapshots: { failed: false, data: [{ domain: 'wendywutours.co.nz', url: 'https://wendywutours.co.nz/china/tours/', page_role: 'product_listing', projection_version: 'me-travel-v2', captured_at: '2026-09-09T00:00:00Z', projection_content: 'Tour: Wonders of China | Duration: 17 days | Price: NZ$9,030 | Promotion: Early Bird' }] },
  baselines: { failed: false, data: [{ domain: 'ctstours.co.nz', seo_score: 26, last_collected_at: '2026-09-01', is_client: true }, { domain: 'wendywutours.co.nz', seo_score: 22, last_collected_at: '2026-09-01', is_client: false }] },
  reputation: { failed: false, data: [] }, ai: { failed: false, data: null },
  now: new Date('2026-09-10T00:00:00Z'),
}

describe('buildCompetitionBrief', () => {
  it('turns current tour evidence into an operating brief without inventing a total score', () => {
    const brief = buildCompetitionBrief(input)
    expect(brief.headline).toContain('竞品Tour盘面已可查看')
    expect(brief.actions).toHaveLength(3)
    expect(brief.dimensions.find(item => item.key === 'product')?.detail).toContain('NZ$9,030')
    expect(brief.dimensions.find(item => item.key === 'search')?.detail).toContain('不等于 Google 排名')
    expect(brief.dimensions.find(item => item.key === 'reputation')?.status).toBe('unconfigured')
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
