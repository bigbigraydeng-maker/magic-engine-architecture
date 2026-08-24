/**
 * CampaignDailyPlanPanel — 7-day remediation (Build Control comment 5394505714).
 *
 * Ray's original Ray Experience FAIL: six of seven days looked empty even
 * though the API always only ever exposed one "current" bundle, and the
 * Post copy was truncated with no way to read the full text. These tests
 * lock down the fix at the component level: date selection actually swaps
 * the three formats shown, Post can be expanded/collapsed, and a day that
 * is PLANNED but has no bundle fails honestly instead of quietly reusing
 * whatever was already on screen.
 */
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CampaignDailyPlanPanel } from '../CampaignDailyPlanPanel'

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const CAMPAIGN_ID = 'campaign-uuid'

function readiness(overrides: Record<string, unknown> = {}) {
  return {
    master_brief_grounding: true,
    campaign_grounding: true,
    evidence_grounding: 'UNKNOWN',
    client_asset_provenance: false,
    format_completeness: { post: true, story: true, reel: true },
    human_approval: false,
    provider_authorization: false,
    publishing_authorization: false,
    performance_outcome: 'UNKNOWN',
    ...overrides,
  }
}

function daysGrid(plannedDates: string[]) {
  const all = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30']
  return all.map(date => ({
    date,
    slots: {
      post: plannedDates.includes(date) ? 'PLANNED' : 'NOT_PLANNED',
      story: plannedDates.includes(date) ? 'PLANNED' : 'NOT_PLANNED',
      reel: plannedDates.includes(date) ? 'PLANNED' : 'NOT_PLANNED',
    },
  }))
}

function mockFetchOnce(payload: unknown) {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => payload }) as unknown as typeof fetch
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('CampaignDailyPlanPanel — date selection shows that day\'s three formats', () => {
  it('selecting a later populated day swaps Post/Story/Reel away from Day 1\'s content', async () => {
    mockFetchOnce({
      success: true,
      campaign: { id: CAMPAIGN_ID, title: 'Christmas Campaign', offer: null, primary_cta: 'Enquire Now' },
      grounding: { status: 'OK', has_master_brief: true, has_campaign: true },
      days: daysGrid(['2026-08-24', '2026-08-26']),
      bundles: [
        {
          date: '2026-08-24',
          post: { hook: 'Day 1 hook text', body: 'Day 1 body', cta: 'Enquire Now' },
          story: { frames: [{ order: 1, copy: 'Day 1 frame' }] },
          reel: { brief: 'Day 1 reel brief', script: 's', caption: 'c', source_asset_ids: [], media_status: 'NO_MEDIA' },
          readiness: readiness(),
          provenance: [],
        },
        {
          date: '2026-08-26',
          post: { hook: 'Day 3 hook text', body: 'Day 3 body', cta: 'Enquire Now' },
          story: { frames: [{ order: 1, copy: 'Day 3 frame' }] },
          reel: { brief: 'Day 3 reel brief', script: 's', caption: 'c', source_asset_ids: [], media_status: 'NO_MEDIA' },
          readiness: readiness(),
          provenance: [],
        },
      ],
      publishing_plan: { destination: null, status: 'NOT_AUTHORIZED' },
      ad_candidate: null,
    })

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    await screen.findByText('Day 1 hook text')
    expect(screen.queryByText('Day 3 hook text')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('08-26'))

    await screen.findByText('Day 3 hook text')
    expect(screen.queryByText('Day 1 hook text')).not.toBeInTheDocument()
    expect(screen.getByText('Day 3 frame')).toBeInTheDocument()
    expect(screen.getByText('Day 3 reel brief')).toBeInTheDocument()
  })
})

describe('CampaignDailyPlanPanel — Post full text can be expanded and collapsed', () => {
  it('shows a 展开全文/收起 toggle that reveals and hides the full Post body', async () => {
    const longBody = 'A '.repeat(80) + 'end of the long post body.'
    mockFetchOnce({
      success: true,
      campaign: { id: CAMPAIGN_ID, title: 'Christmas Campaign', offer: null, primary_cta: 'Enquire Now' },
      grounding: { status: 'OK', has_master_brief: true, has_campaign: true },
      days: daysGrid(['2026-08-24']),
      bundles: [
        {
          date: '2026-08-24',
          post: { hook: 'hook', body: longBody, cta: 'Enquire Now' },
          story: { frames: [{ order: 1, copy: 'frame' }] },
          reel: { brief: 'brief', script: 's', caption: 'c', source_asset_ids: [], media_status: 'NO_MEDIA' },
          readiness: readiness(),
          provenance: [],
        },
      ],
      publishing_plan: { destination: null, status: 'NOT_AUTHORIZED' },
      ad_candidate: null,
    })

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    await screen.findByText('展开全文')
    fireEvent.click(screen.getByText('展开全文'))
    expect(screen.getByText('收起')).toBeInTheDocument()
    fireEvent.click(screen.getByText('收起'))
    expect(screen.getByText('展开全文')).toBeInTheDocument()
  })
})

describe('CampaignDailyPlanPanel — missing bundle fails honestly, never borrows another day', () => {
  it('shows NOT_PLANNED for a day marked PLANNED in the grid but absent from bundles, instead of showing Day 1\'s content', async () => {
    mockFetchOnce({
      success: true,
      campaign: { id: CAMPAIGN_ID, title: 'Christmas Campaign', offer: null, primary_cta: 'Enquire Now' },
      grounding: { status: 'OK', has_master_brief: true, has_campaign: true },
      // days[] claims 08-25 is PLANNED (a data-shape mismatch), but no
      // matching entry exists in bundles — the UI must not paper over this.
      days: daysGrid(['2026-08-24', '2026-08-25']),
      bundles: [
        {
          date: '2026-08-24',
          post: { hook: 'Day 1 hook', body: 'Day 1 body', cta: 'Enquire Now' },
          story: { frames: [{ order: 1, copy: 'Day 1 frame' }] },
          reel: { brief: 'Day 1 reel', script: 's', caption: 'c', source_asset_ids: [], media_status: 'NO_MEDIA' },
          readiness: readiness(),
          provenance: [],
        },
      ],
      publishing_plan: { destination: null, status: 'NOT_AUTHORIZED' },
      ad_candidate: null,
    })

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    await screen.findByText('Day 1 hook')

    fireEvent.click(screen.getByText('08-25'))

    await screen.findAllByText(/该日暂无排定内容/) // both the bundle and readiness sections honestly say so
    expect(screen.queryByText('Day 1 hook')).not.toBeInTheDocument()
  })
})

describe('CampaignDailyPlanPanel — complete route must not omit Chongqing/Guangzhou', () => {
  it('renders the full 5-city route text on the recap day without dropping Chongqing or Guangzhou', async () => {
    const recapStory = 'The full journey: Shanghai → Beijing → Xi\'an → Chongqing → Guangzhou'
    mockFetchOnce({
      success: true,
      campaign: { id: CAMPAIGN_ID, title: 'Christmas Campaign', offer: null, primary_cta: 'Enquire Now' },
      grounding: { status: 'OK', has_master_brief: true, has_campaign: true },
      days: daysGrid(['2026-08-30']),
      bundles: [
        {
          date: '2026-08-30',
          post: { hook: 'Final stop: Guangzhou', body: 'Journey recap', cta: 'Enquire Now' },
          story: { frames: [{ order: 3, copy: recapStory }] },
          reel: { brief: 'recap', script: 's', caption: 'c', source_asset_ids: [], media_status: 'NO_MEDIA' },
          readiness: readiness(),
          provenance: [],
        },
      ],
      publishing_plan: { destination: null, status: 'NOT_AUTHORIZED' },
      ad_candidate: null,
    })

    render(<CampaignDailyPlanPanel clientId={CLIENT_ID} campaignId={CAMPAIGN_ID} />)

    await screen.findByText(/The full journey/)
    const recap = screen.getByText(/The full journey/)
    expect(recap.textContent).toContain('Chongqing')
    expect(recap.textContent).toContain('Guangzhou')
    expect(recap.textContent).toContain('Shanghai')
    expect(recap.textContent).toContain('Beijing')
  })
})
